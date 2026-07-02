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
import { ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp, LineData, WhitespaceData, HistogramData } from "lightweight-charts";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import type { FlowOrder } from "@/hooks/useSpxFlow";

const C = HOME_THEME;
const BUY_GREEN = "#22c55e";
const BULLISH = BUY_GREEN; // calls / buys
const BEARISH = C.red; //     puts / sells
const VOL_GREEN = "rgba(34,197,94,0.55)";
const VOL_RED = "rgba(239,68,68,0.55)";

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

// ── RTH session bounds (9:30–16:00 America/New_York) for TODAY, as UTC seconds.
// Handles EDT/EST automatically by correcting a UTC guess against the ET offset.
function etDateParts(now: Date): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}
function etWallToUtcSec(y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const asET = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
  const asUTC = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return Math.floor((guess + (asUTC - asET)) / 1000);
}
function rthBoundsToday(): { openSec: number; closeSec: number } {
  const { y, m, d } = etDateParts(new Date());
  return { openSec: etWallToUtcSec(y, m, d, 9, 30), closeSec: etWallToUtcSec(y, m, d, 16, 0) };
}

// ── Filter state ────────────────────────────────────────────────────────────
type SideFilter = "all" | "buy" | "sell";
type TypeFilter = "all" | "C" | "P";

const PREMIUM_MAX = 1_000_000;

// Net-drift chart bucket size (seconds). Fixed bins across the whole RTH session
// give a proportional, hardcoded 9:30–4:00 x-axis and a smooth line.
const BIN_SEC = 60;

// Per-bin aggregate from /proxy/flow-netprem (server-side GROUP BY).
type NetBin = { sec: number; callNet: number; putNet: number; callVol: number; putVol: number };

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
  // Aggregated per-bin net premium for the ACTIVE ticker — the chart's source.
  // Polled every 5s: advances the "now" edge, and self-heals a transient DB blip
  // (an empty response just gets replaced by the next poll).
  const [netBins, setNetBins] = useState<NetBin[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/proxy/flow-netprem?underlying=${encodeURIComponent(active)}&bin=${BIN_SEC}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && j && Array.isArray(j.bins)) setNetBins(j.bins as NetBin[]); })
        .catch(() => {});
    setNetBins([]);
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active]);

  // ── Backfill the ACTIVE ticker's full session whenever it changes. ──
  // Per-ticker so the whole day is returned (an unfiltered newest-N cap drops a
  // ticker's early prints once the full roster is recording).
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    fetch(`/proxy/flow-history?underlying=${encodeURIComponent(active)}&limit=20000`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !Array.isArray(j.tape)) return;
        setHistory(j.tape as FlowOrder[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [active]);

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
    const { openSec, closeSec } = rthBoundsToday();
    const byBin = new Map<number, NetBin>();
    for (const b of netBins) byBin.set(b.sec, b);
    const hasData = netBins.length > 0;

    // Fixed 1-min bins across the whole RTH session → proportional, hardcoded
    // 9:30–4:00 axis. Walk the aggregate into cumulative net-drift lines; bins up
    // to "now" carry the running total, future bins are whitespace (axis still
    // spans to the close before data arrives).
    const nowSec = Math.floor(Date.now() / 1000);
    const callPts: (LineData | WhitespaceData)[] = [];
    const putPts: (LineData | WhitespaceData)[] = [];
    const volPts: (HistogramData | WhitespaceData)[] = [];
    let call = 0, put = 0;
    for (let t = openSec; t <= closeSec; t += BIN_SEC) {
      const b = byBin.get(t);
      if (b) { call += b.callNet; put += b.putNet; }
      if (t <= nowSec + BIN_SEC) {
        callPts.push({ time: t as UTCTimestamp, value: call });
        putPts.push({ time: t as UTCTimestamp, value: put });
        const cv = b ? b.callVol : 0, pv = b ? b.putVol : 0;
        volPts.push({ time: t as UTCTimestamp, value: cv + pv, color: cv >= pv ? VOL_GREEN : VOL_RED });
      } else {
        callPts.push({ time: t as UTCTimestamp });
        putPts.push({ time: t as UTCTimestamp });
        volPts.push({ time: t as UTCTimestamp });
      }
    }
    return { callPts, putPts, volPts, lastCall: call, lastPut: put, openSec, closeSec, hasData, byBin };
  }, [netBins]);

  // ── lightweight-charts setup ──
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const callSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const putSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const binMapRef = useRef<Map<number, NetBin>>(new Map());
  const ordersByMinRef = useRef<Map<number, FlowOrder[]>>(new Map());

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;
    host.innerHTML = "";
    host.style.position = "relative";

    // Floating hover tooltip — shows what was hit in the crosshair minute.
    const tooltip = document.createElement("div");
    Object.assign(tooltip.style, {
      position: "absolute", display: "none", pointerEvents: "none", zIndex: "20",
      minWidth: "230px", padding: "0", borderRadius: "12px", overflow: "hidden",
      fontSize: "12px", lineHeight: "1.4",
      background: "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.10) 0%, transparent 60%), rgba(10,13,20,0.96)",
      border: `1px solid ${C.border}`, borderTop: "2px solid rgba(33,158,188,0.5)",
      color: C.text, whiteSpace: "nowrap",
      fontFamily: "var(--font-mono)",
      boxShadow: "0 10px 30px rgba(0,0,0,.55)", backdropFilter: "blur(6px)",
    } as CSSStyleDeclaration);
    host.appendChild(tooltip);
    tooltipRef.current = tooltip;
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
      timeScale: {
        borderColor: "rgba(255,255,255,.10)",
        timeVisible: true,
        secondsVisible: false,
        // Axis tick labels in ET (tickMarkFormatter drives the axis; the
        // localization.timeFormatter only affects the crosshair label).
        tickMarkFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
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
    // Volume histogram docked to the bottom ~22% (its own overlay price scale).
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });

    chart.subscribeCrosshairMove((param) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      const t = typeof param.time === "number" ? param.time : null;
      const bin = t != null ? binMapRef.current.get(t) : undefined;
      if (!param.point || t == null || !bin || (bin.callVol === 0 && bin.putVol === 0)) {
        tip.style.display = "none";
        return;
      }
      const orders = ordersByMinRef.current.get(t) ?? [];
      // Nothing OTM printed this minute → don't show an empty tooltip.
      if (orders.length === 0) { tip.style.display = "none"; return; }
      const et = new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
      const MAX_ROWS = 8;
      const rows = orders.slice(0, MAX_ROWS).map((o) => {
        const buy = o.side === "buy";
        const col = buy ? BULLISH : BEARISH;
        const tint = buy ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
        return (
          `<div style="display:flex;align-items:center;gap:8px;border-left:3px solid ${col};background:${tint};border-radius:0 6px 6px 0;padding:5px 8px">` +
          `<span style="color:${col};font-weight:700;width:32px">${buy ? "BUY" : "SELL"}</span>` +
          `<span style="color:#fff;flex:1">${o.strike.toLocaleString()}${o.type} ×${o.size.toLocaleString()}</span>` +
          `<span style="color:${col}">${fmtPremium(o.premium)}</span>` +
          `</div>`
        );
      }).join("");
      const more = orders.length > MAX_ROWS ? `<div style="color:rgba(255,255,255,.45);font-family:var(--font-mono);font-size:11px;padding:4px 8px 0">+${orders.length - MAX_ROWS} more…</div>` : "";
      tip.innerHTML =
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.08)">` +
          `<span style="color:#fff;font-weight:500;font-size:13px">${et}</span>` +
          `<span style="color:rgba(255,255,255,.5);font-size:10px;font-family:var(--font-mono);letter-spacing:.06em">OTM · ${orders.length} print${orders.length === 1 ? "" : "s"}</span>` +
        `</div>` +
        `<div style="padding:8px 10px;font-family:var(--font-mono);font-size:11px;display:flex;flex-direction:column;gap:5px">${rows}${more}</div>`;
      tip.style.display = "block";
      const hostW = host.clientWidth, tipW = tip.offsetWidth;
      let left = param.point.x + 16;
      if (left + tipW > hostW) left = param.point.x - tipW - 16;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${Math.max(4, param.point.y - 10)}px`;
    });

    chartRef.current = chart;
    callSeriesRef.current = callSeries;
    putSeriesRef.current = putSeries;
    volSeriesRef.current = volSeries;
    return () => { chart.remove(); chartRef.current = null; callSeriesRef.current = null; putSeriesRef.current = null; volSeriesRef.current = null; tooltipRef.current = null; };
  }, []);

  // Push data whenever the active-ticker series changes.
  useEffect(() => {
    binMapRef.current = netSeries.byBin;
    // Index the visible tape by minute-bin so the chart hover can list the
    // actual orders that printed in the crosshair minute (biggest first).
    const idx = new Map<number, FlowOrder[]>();
    for (const o of filtered) {
      if (!o.isOtm) continue; // tooltip lists OTM prints only
      const minSec = Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC;
      const arr = idx.get(minSec);
      if (arr) arr.push(o); else idx.set(minSec, [o]);
    }
    for (const arr of idx.values()) arr.sort((a, b) => (b.premium || 0) - (a.premium || 0));
    ordersByMinRef.current = idx;
    callSeriesRef.current?.setData(netSeries.callPts);
    putSeriesRef.current?.setData(netSeries.putPts);
    volSeriesRef.current?.setData(netSeries.volPts);
    // Pin the axis to the exact 9:30–4:00 window (fitContent trims trailing
    // whitespace and re-scrolls, floating the data to the right).
    try {
      chartRef.current?.timeScale().setVisibleRange({
        from: netSeries.openSec as UTCTimestamp,
        to: netSeries.closeSec as UTCTimestamp,
      });
    } catch {}
  }, [netSeries, filtered]);

  // ── Summary of the filtered tape. ──
  const totals = useMemo(() => {
    let prem = 0, callPrem = 0, putPrem = 0;
    let buyCall = 0, buyPut = 0, sellCall = 0, sellPut = 0;
    for (const o of filtered) {
      const p = o.premium || 0;
      prem += p;
      if (o.type === "C") { callPrem += p; if (o.side === "buy") buyCall += p; else sellCall += p; }
      else { putPrem += p; if (o.side === "buy") buyPut += p; else sellPut += p; }
    }
    return { count: filtered.length, prem, callPrem, putPrem, buyCall, buyPut, sellCall, sellPut };
  }, [filtered]);

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
      <Card accent="cyan" title="Options Flow — Filters" subtitle="Live order flow off the /ws/gex feed. Pick a watched ticker to drive the chart + tape." style={{ flexShrink: 0 }}>
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
      <Card accent="orange" padding={0} style={{ flexShrink: 0 }}>
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
        {!netSeries.hasData && (
          <p style={{ fontSize: 13, padding: "0 20px 12px", color: C.muted, textAlign: "center" }}>
            {status === "LIVE" ? `No ${active} flow yet for the current filters.` : "Connecting to feed…"}
          </p>
        )}
        {/* Premium split — four cards: buy/sell × call/put */}
        <div style={{ padding: "6px 20px 20px" }}>
          <label style={labelStyle}>Premium Split (Filtered Tape)</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {([
              { label: "BUY CALLS", value: totals.buyCall, color: BULLISH },
              { label: "BUY PUTS", value: totals.buyPut, color: BEARISH },
              { label: "SELL CALL", value: totals.sellCall, color: BULLISH },
              { label: "SELL PUT", value: totals.sellPut, color: BEARISH },
            ] as const).map((c) => (
              <div key={c.label} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.4)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>{c.label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: c.color, fontFamily: "var(--font-mono)" }}>{fmtPremium(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Tape ────────────────────────────────────────────────────── */}
      <Card accent="purple" padding={0} style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 22, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>Flow Tape — {active}</span>
            <span style={{ fontSize: 12, color: C.muted }}><strong style={{ color: C.text }}>{totals.count.toLocaleString()}</strong> orders</span>
            <span style={{ fontSize: 12, color: C.muted }}>Total <strong style={{ color: C.text }}>{fmtPremium(totals.prem)}</strong></span>
            <span style={{ fontSize: 12, color: C.muted }}>Calls <strong style={{ color: BULLISH }}>{fmtPremium(totals.callPrem)}</strong></span>
            <span style={{ fontSize: 12, color: C.muted }}>Puts <strong style={{ color: BEARISH }}>{fmtPremium(totals.putPrem)}</strong></span>
          </div>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 10px", borderRadius: 4, background: status === "LIVE" ? "rgba(142,202,230,0.12)" : "rgba(239,68,68,0.12)", color: status === "LIVE" ? C.cyan : C.red }}>
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

        <div>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, padding: 24, color: C.muted }}>
              {status === "LIVE" ? `No ${active} flow matches the current filters.` : "Connecting to feed…"}
            </p>
          ) : (
            filtered.map((o, i) => {
              const sideColor = o.side === "buy" ? BULLISH : BEARISH;
              return (
                <div key={`${o.ts}-${o.symbol}-${i}`} style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "8px 20px", borderBottom: `1px solid ${C.border}`, fontSize: 15, fontFamily: "var(--font-mono)", alignItems: "center" }}>
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
