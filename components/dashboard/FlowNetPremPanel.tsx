"use client";

// FlowNetPremPanel — self-contained "Net Premium" dashboard tile for the home
// grid (app/home/HomeClient.tsx). Distilled from app/flow/page.tsx: just the
// cumulative net-premium (call vs put) chart for one active ticker, fed by the
// same /proxy/flow-netprem SQL aggregate the /flow page uses, plus a compact
// pop-out filter panel (ticker / side / type / min premium / min size / OTM)
// so the tile doesn't need to permanently reserve space for filter controls.
//
// No toolbar/nav, no raw order tape — just the chart + a floating filter
// panel. Fills whatever container it's placed in (width/height 100%), same
// pattern as EsCandlesCard.tsx.
//
// Theme: HOME_THEME / DOCK_THEME tokens only — no ad-hoc hex colors beyond the
// true-green buy accent already used on /flow (HOME_THEME.green is light blue).

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp, LineData, WhitespaceData, HistogramData } from "lightweight-charts";
import { HOME_THEME, homeInputStyle, DOCK_THEME } from "@/components/shared/homeTheme";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";

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

type SideFilter = "all" | "buy" | "sell";
type TypeFilter = "all" | "C" | "P";

const PREMIUM_MAX = 1_000_000;
// Net-drift chart bucket size (seconds) — fixed bins across the whole RTH
// session give a proportional, hardcoded 9:30–4:00 x-axis and a smooth line.
const BIN_SEC = 60;

type NetBin = { sec: number; callNet: number; putNet: number; callVol: number; putVol: number };

const TICKERS = ["SPX", "SPY", "QQQ", "META", "TSLA", "AMZN", "AAPL", "NVDA", "MSFT", "GOOGL", "AMD", "NDX"] as const;

// ── ET/RTH helpers (mirrors app/flow/page.tsx) ──────────────────────────────
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
function todayYmdET(): string {
  const { y, m, d } = etDateParts(new Date());
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function FlowNetPremPanel() {
  const shouldConnect = useWsLifecycle();

  const [active, setActive] = useState<string>(TICKERS[0]);
  const [side, setSide] = useState<SideFilter>("all");
  const [optType, setOptType] = useState<TypeFilter>("all");
  const [minPremium, setMinPremium] = useState<number>(50_000);
  const [minSize, setMinSize] = useState<number>(0);
  const [otmOnly, setOtmOnly] = useState(true);
  const [dteMin, setDteMin] = useState<number>(0);
  const [dteMax, setDteMax] = useState<number | null>(0); // default: 0DTE only
  const [filtersOpen, setFiltersOpen] = useState(false);

  const date = todayYmdET();

  // ── Net-drift bins for the active ticker (server-aggregated, whole session). ──
  const [netBins, setNetBins] = useState<NetBin[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!shouldConnect) return;
    let cancelled = false;
    setLoading(true);
    const qp = new URLSearchParams({ underlying: active, bin: String(BIN_SEC), date });
    if (side !== "all") qp.set("side", side);
    if (optType !== "all") qp.set("type", optType);
    if (minPremium > 0) qp.set("minPremium", String(minPremium));
    if (minSize > 0) qp.set("minSize", String(minSize));
    if (dteMin > 0) qp.set("dteMin", String(dteMin));
    if (dteMax != null) qp.set("dteMax", String(dteMax));
    if (otmOnly) qp.set("otmOnly", "1");
    const load = () =>
      fetch(`/proxy/flow-netprem?${qp.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled) return;
          if (j && Array.isArray(j.bins)) setNetBins(j.bins as NetBin[]);
          setLoading(false);
        })
        .catch(() => { if (!cancelled) setLoading(false); });
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, date, side, optType, minPremium, minSize, dteMin, dteMax, otmOnly, shouldConnect]);

  const netSeries = useMemo(() => {
    const { openSec, closeSec } = rthBoundsToday();
    const byBin = new Map<number, NetBin>();
    for (const b of netBins) byBin.set(b.sec, b);
    const hasData = netBins.length > 0;

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
    return { callPts, putPts, volPts, lastCall: call, lastPut: put, openSec, closeSec, hasData };
  }, [netBins]);

  // ── lightweight-charts setup, sized to fill the container (ResizeObserver,
  // same pattern as EsCandlesCard) rather than a fixed height. ──
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const callSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const putSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.text,
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
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.24 } });

    chartRef.current = chart;
    callSeriesRef.current = callSeries;
    putSeriesRef.current = putSeries;
    volSeriesRef.current = volSeries;

    let lastW = 0, lastH = 0;
    const applySize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
      }
    };
    const ro = new ResizeObserver(applySize);
    ro.observe(container);

    let rafId = 0, tries = 0;
    const pump = () => {
      applySize();
      tries++;
      if ((lastW === 0 || lastH === 0) && tries < 120) rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      callSeriesRef.current = null;
      putSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    callSeriesRef.current?.setData(netSeries.callPts);
    putSeriesRef.current?.setData(netSeries.putPts);
    volSeriesRef.current?.setData(netSeries.volPts);
    try {
      chartRef.current?.timeScale().setVisibleRange({
        from: netSeries.openSec as UTCTimestamp,
        to: netSeries.closeSec as UTCTimestamp,
      });
    } catch {}
  }, [netSeries]);

  function resetFilters() {
    setSide("all"); setOptType("all"); setMinPremium(50_000); setMinSize(0); setOtmOnly(true);
    setDteMin(0); setDteMax(0);
  }

  // ── Styles ──
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: C.green, marginBottom: 4, display: "block",
  };
  const fieldStyle: React.CSSProperties = { ...homeInputStyle, width: "100%", fontSize: 12, padding: "6px 8px" };
  const segWrapStyle: React.CSSProperties = {
    display: "flex", border: `1px solid ${C.border}`, borderRadius: 6, background: "rgba(0,0,0,0.4)", overflow: "hidden",
  };
  function segBtn(activeState: boolean): React.CSSProperties {
    return {
      flex: 1, padding: "5px 4px", fontSize: 10, fontWeight: 700, cursor: "pointer",
      textTransform: "uppercase", letterSpacing: "0.04em", border: "none",
      background: activeState ? DOCK_THEME.activeTile : "transparent",
      color: activeState ? C.cyan : C.text,
      boxShadow: activeState ? DOCK_THEME.activeGlow : "none",
      transition: "all 0.15s",
    };
  }

  const filterActiveCount =
    (side !== "all" ? 1 : 0) + (optType !== "all" ? 1 : 0) + (minPremium !== 50_000 ? 1 : 0) +
    (minSize > 0 ? 1 : 0) + (!otmOnly ? 1 : 0) + (dteMin > 0 ? 1 : 0) + (dteMax !== 0 ? 1 : 0);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* ── Header: ticker picker + summary + pop-out filter toggle ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <select
            style={{ ...homeInputStyle, fontSize: 12, padding: "4px 8px", width: 84 }}
            value={active}
            onChange={(e) => setActive(e.target.value)}
          >
            {TICKERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.text, whiteSpace: "nowrap" }}>Net Premium</span>
          {loading && <span style={{ fontSize: 10, color: C.muted }}>· loading…</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: BULLISH, whiteSpace: "nowrap" }}>● {fmtPremium(netSeries.lastCall)}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: BEARISH, whiteSpace: "nowrap" }}>● {fmtPremium(netSeries.lastPut)}</span>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            style={{
              position: "relative", padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer",
              textTransform: "uppercase", letterSpacing: "0.06em", borderRadius: 6,
              border: `1px solid ${filtersOpen ? DOCK_THEME.activeBorder : C.border}`,
              background: filtersOpen ? DOCK_THEME.activeTile : "rgba(0,0,0,0.4)",
              color: filtersOpen ? C.cyan : C.text,
              boxShadow: filtersOpen ? DOCK_THEME.activeGlow : "none",
              transition: "all 0.15s",
            }}
          >
            Filters{filterActiveCount > 0 ? ` (${filterActiveCount})` : ""} {filtersOpen ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* ── Chart body ── */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {!netSeries.hasData && !loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12, pointerEvents: "none" }}>
            No {active} flow yet for the current filters.
          </div>
        )}
      </div>

      {/* ── Pop-out filter panel — floats over the chart, doesn't reflow layout. ── */}
      {filtersOpen && (
        <>
          <div
            onClick={() => setFiltersOpen(false)}
            style={{ position: "absolute", inset: 0, zIndex: 29, background: "rgba(0,0,0,0.15)" }}
          />
          <div
            style={{
              position: "absolute", top: 40, right: 8, zIndex: 30, width: 260,
              // The panel's content (~400px of controls) is taller than a short
              // dock tile, and its offset parent is that tile (height:100%), so
              // an unbounded panel spills past the bottom and gets clipped —
              // Moneyness/Reset became unreachable. Bound it to whatever room is
              // left under the header and scroll the overflow instead.
              maxHeight: "calc(100% - 48px)", overflowY: "auto", overscrollBehavior: "contain",
              background: "radial-gradient(circle at 50% 0%, rgba(33,158,188,0.10) 0%, transparent 60%), rgba(10,13,20,0.97)",
              border: `1px solid ${C.border}`, borderTop: "2px solid rgba(33,158,188,0.5)",
              borderRadius: 12, boxShadow: "0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)",
              backdropFilter: "blur(16px)", padding: 14, display: "flex", flexDirection: "column", gap: 12,
            }}
          >
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
              <label style={labelStyle}>DTE Range</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={fieldStyle} type="number" min={0} placeholder="min" value={dteMin || ""} onChange={(e) => setDteMin(Number(e.target.value) || 0)} />
                <input style={fieldStyle} type="number" min={0} placeholder="max" value={dteMax ?? ""} onChange={(e) => setDteMax(e.target.value === "" ? null : Number(e.target.value))} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Moneyness</label>
              <div style={segWrapStyle}>
                <button style={segBtn(!otmOnly)} onClick={() => setOtmOnly(false)}>All</button>
                <button style={segBtn(otmOnly)} onClick={() => setOtmOnly(true)}>OTM</button>
              </div>
            </div>

            <button
              onClick={resetFilters}
              style={{
                padding: "6px 6px", fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                border: `1px solid ${C.border}`, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: C.text,
              }}
            >
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}
