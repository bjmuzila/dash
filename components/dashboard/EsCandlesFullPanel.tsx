"use client";

// EsCandlesFullPanel — the "exact chart" from the full /es-candles page,
// self-contained for the HOME2 dashboard tab grid: live ES 5m candlesticks
// PLUS the GEX overlay (Call Wall / Put Wall / Gamma Flip price lines) and
// the vertical GEX-by-strike rail, fed by the same useEsCandles hook + the
// same /ws/gex level stream the full page uses. No toolbar / Dock / nav
// chrome, no heatmap canvas, no TPO/volume-profile/session-H-L extras — those
// live behind buttons on the full page and aren't part of "the chart" itself.
// Zero required props; fills whatever box it's placed in (ResizeObserver).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import { HOME_THEME } from "@/components/shared/homeTheme";
import EsGexRail, { type RailRow } from "@/components/dashboard/EsGexRail";

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// Auto-collapse the fixed-width rail when the panel gets too narrow, same
// threshold the full page uses (app/es-candles/page.tsx RAIL_MIN_WIDTH).
const RAIL_MIN_WIDTH = 560;
const RAIL_WIDTH = 230;

export default function EsCandlesFullPanel() {
  const esShouldConnect = useWsLifecycle();
  const esShouldConnectRef = useRef(esShouldConnect);
  esShouldConnectRef.current = esShouldConnect;

  const { sessionCandles: rows, connected } = useEsCandles();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);
  const lastFitDayRef = useRef("");

  const [railFits, setRailFits] = useState(true);
  const railDrawRef = useRef<() => void>(() => {});

  // GEX levels + basis, mirrors app/es-candles/page.tsx `levels` state.
  const [levels, setLevels] = useState<{
    callWall: number | null;
    putWall: number | null;
    gexFlip: number | null;
    spx: number | null;
    esFut: number | null;
    basis: number | null;
  }>({ callWall: null, putWall: null, gexFlip: null, spx: null, esFut: null, basis: null });
  const basisRef = useRef(0);
  const [railRows, setRailRows] = useState<RailRow[]>([]);

  const effectiveBasis = useCallback(() => basisRef.current, []);

  const priceToY = useCallback((esPrice: number): number | null => {
    const s = candleSeriesRef.current;
    if (!s) return null;
    const y = s.priceToCoordinate(esPrice);
    return y == null ? null : (y as number);
  }, []);

  // ── Chart setup (once) ──────────────────────────────────────────────────
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,.70)",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.06)" },
        horzLines: { color: "rgba(255,255,255,.06)" },
      },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: unknown, tickMarkType: number) => {
          if (typeof t !== "number") return "";
          const d = new Date(t * 1000);
          if (tickMarkType === 2 || tickMarkType === 3) {
            return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
          }
          return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
        },
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (price: number) => price.toFixed(2),
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      wickUpColor: "#30d158",
      upColor: "#30d158",
      wickDownColor: "#ff5b5b",
      downColor: "#ff5b5b",
      borderVisible: false,
    });
    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;

    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.round(container.clientWidth);
      const h = Math.round(container.clientHeight);
      if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
      const wasCollapsed = lastW <= 0 || lastH <= 0;
      lastW = w; lastH = h;
      chart.applyOptions({ width: w, height: h });
      if (wasCollapsed) chart.timeScale().fitContent();
      railDrawRef.current();
    });
    ro.observe(container);
    lastW = Math.round(container.clientWidth);
    lastH = Math.round(container.clientHeight);
    chart.applyOptions({ width: lastW, height: lastH });

    // Poll on rAF until the container has a real size (it starts at 0 inside
    // a grid cell that lays out after mount) — same guard as EsCandlesCard.
    let rafId = 0;
    let tries = 0;
    const pump = () => {
      const w = Math.round(container.clientWidth);
      const h = Math.round(container.clientHeight);
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH || !didFitRef.current)) {
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
        chart.timeScale().fitContent();
        railDrawRef.current();
      }
      tries++;
      if ((w === 0 || h === 0) && tries < 120) rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);

    const onDblClick = () => {
      chart.timeScale().fitContent();
      chart.priceScale("right").applyOptions({ autoScale: true });
      railDrawRef.current();
    };
    container.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      container.removeEventListener("dblclick", onDblClick);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      didFitRef.current = false;
    };
  }, []);

  // ── Feed candle data ────────────────────────────────────────────────────
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !chart) return;

    const candleData: CandlestickData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open, high: row.high, low: row.low, close: row.close,
    }));
    candleSeries.setData(candleData);

    const lastDay = candleData.length ? rows[rows.length - 1].date : "";
    if (candleData.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
      lastFitDayRef.current = lastDay;
    }
    railDrawRef.current();
  }, [rows]);

  // ── /ws/gex: GEX levels (Call Wall / Put Wall / Flip) + basis + rail rows ─
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const apply = (d: Record<string, unknown>) => {
      const spx = Number(d.spot ?? 0);
      const esFut = Number(d.esFut ?? 0);
      const rawBasis = Number(d.basis);
      const dBasis = Number.isFinite(rawBasis) && Math.abs(rawBasis) > 0.01 ? rawBasis : null;

      let computedFlip: number | null = null;
      if (Array.isArray(d.gexRows) && d.gexRows.length) {
        computedFlip = findGEXFlip(d.gexRows as ChainRow[], spx > 0 ? spx : undefined);
      }
      setLevels((prev) => {
        const nextSpx = spx > 0 ? spx : prev.spx;
        const nextEs = esFut > 0 ? esFut : prev.esFut;
        const nextBasis = dBasis != null ? dBasis : prev.basis;
        if (nextBasis != null && !basisRef.current) basisRef.current = nextBasis;
        else if (!basisRef.current && nextSpx != null && nextEs != null) basisRef.current = nextEs - nextSpx;
        return {
          callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
          putWall: d.putWall != null ? Number(d.putWall) || null : prev.putWall,
          gexFlip: computedFlip != null ? computedFlip : (d.gexFlip != null ? Number(d.gexFlip) || null : prev.gexFlip),
          basis: nextBasis,
          spx: nextSpx,
          esFut: nextEs,
        };
      });

      const gexRows = d.gexRows;
      if (Array.isArray(gexRows) && gexRows.length) {
        const nextRail: RailRow[] = [];
        for (const r of gexRows as Array<Record<string, unknown>>) {
          const strike = Number(r.strike ?? 0);
          const netOi = Number(r.netGEX ?? r.net_gex ?? r.netGexVal ?? 0);
          const netVol = Number(r.netVolGEX ?? 0);
          if (!(strike > 0)) continue;
          const net = (Number.isFinite(netOi) ? netOi : 0) + (Number.isFinite(netVol) ? netVol : 0);
          nextRail.push({ strike, net });
        }
        if (nextRail.length) setRailRows(nextRail);
      }
    };

    const handle = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex" || type === "GEX_UPDATE" || type === "spot" || type === "aux") apply(d);
    };

    const connect = () => {
      if (dead || !esShouldConnectRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead || !esShouldConnectRef.current) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };

    if (esShouldConnect) connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws?.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
  }, [esShouldConnect]);

  // ── Draw GEX level price lines (Call Wall / Put Wall / Flip) ────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];

    const basis = effectiveBasis();
    const toEs = (spxLevel: number | null) => (spxLevel != null ? spxLevel + basis : null);

    const defs: Array<{ price: number | null; color: string; title: string; style: LineStyle; width: 1 | 2 }> = [
      { price: toEs(levels.callWall), color: "#30d158", title: "Call Wall", style: LineStyle.Dashed, width: 1 },
      { price: toEs(levels.putWall), color: "#ff5b5b", title: "Put Wall", style: LineStyle.Dashed, width: 1 },
      { price: toEs(levels.gexFlip), color: "#f5c518", title: "Flip", style: LineStyle.Dashed, width: 1 },
    ];

    for (const d of defs) {
      if (d.price == null || !(d.price > 0)) continue;
      const pl = series.createPriceLine({
        price: d.price,
        color: d.color,
        lineWidth: d.width,
        lineStyle: d.style,
        axisLabelVisible: true,
        title: d.title,
      });
      priceLinesRef.current.push(pl);
    }
  }, [levels, effectiveBasis]);

  // Auto-collapse the rail when the panel is too narrow for both it and a
  // usable candle chart (mirrors app/es-candles/page.tsx RAIL_MIN_WIDTH gate).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRailFits(el.clientWidth >= RAIL_MIN_WIDTH));
    ro.observe(el);
    setRailFits(el.clientWidth >= RAIL_MIN_WIDTH);
    return () => ro.disconnect();
  }, []);

  const showRail = useMemo(() => railFits, [railFits]);
  const last = rows.length ? rows[rows.length - 1] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, display: "flex" }}>
      <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
        <div ref={chartContainerRef} style={{ position: "absolute", inset: 0 }} />
        {rows.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6f7d8c", fontSize: 11 }}>
            {connected ? "Loading ES candles…" : "Connecting…"}
          </div>
        )}
        {last && (
          <div
            style={{
              position: "absolute", left: 8, top: 6, fontSize: 11,
              fontFamily: "var(--font-mono)", color: HOME_THEME.text,
              background: "rgba(5,8,13,.6)", padding: "2px 7px", borderRadius: 6,
              pointerEvents: "none",
            }}
          >
            ES {last.close.toFixed(2)}
          </div>
        )}
      </div>
      {showRail && (
        <div style={{ width: RAIL_WIDTH, flexShrink: 0, marginLeft: 8, minHeight: 0 }}>
          <EsGexRail
            rows={railRows}
            callWall={levels.callWall}
            putWall={levels.putWall}
            gexFlip={levels.gexFlip}
            spot={levels.spx}
            basis={effectiveBasis()}
            priceToY={priceToY}
            drawRef={railDrawRef}
          />
        </div>
      )}
    </div>
  );
}
