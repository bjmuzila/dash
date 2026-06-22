"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData, HistogramData } from "lightweight-charts";
import { usePageLoadStatus } from "@/lib/pageStatus";
import { useEsCandles } from "@/hooks/useEsCandles";

function etClock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

export default function EsCandlesPage() {
  usePageLoadStatus({ pageKey: "es-candles", pageLabel: "ES Candles", path: "/es-candles" });

  // Single source of truth: SQL load (today + ~20d history) + live /ws/gex merge.
  const { candles: rows, connected, refresh } = useEsCandles();

  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);

  // GEX levels from /ws/gex. callWall/putWall/gexFlip are SPX-point values; the
  // chart plots ES, so we offset by the live basis (esFut - spx) before drawing.
  // mvc is plumbed but disabled for now (lives in mvc_snapshots, not the feed).
  const [levels, setLevels] = useState<{
    callWall: number | null;
    putWall: number | null;
    gexFlip: number | null;
    mvc: number | null;
    spx: number | null;
    esFut: number | null;
  }>({ callWall: null, putWall: null, gexFlip: null, mvc: null, spx: null, esFut: null });

  const status = connected ? "live" : "offline";
  const lastCandle = rows[rows.length - 1];

  // Listen to /ws/gex for the GEX levels + ES basis inputs.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const apply = (d: Record<string, unknown>) => {
      setLevels((prev) => ({
        callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
        putWall:  d.putWall  != null ? Number(d.putWall)  || null : prev.putWall,
        gexFlip:  d.gexFlip  != null ? Number(d.gexFlip)  || null : prev.gexFlip,
        mvc:      prev.mvc,
        spx:      Number(d.spot ?? 0)  > 0 ? Number(d.spot)  : prev.spx,
        esFut:    Number(d.esFut ?? 0) > 0 ? Number(d.esFut) : prev.esFut,
      }));
    };

    const handle = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex" || type === "GEX_UPDATE" || type === "spot" || type === "aux") apply(d);
    };

    const connect = () => {
      if (dead) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };

    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      const container = chartRef.current;
      if (!container) return;
      if (canceled) return;

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
        rightPriceScale: {
          borderColor: "rgba(255,255,255,.10)",
        },
        timeScale: {
          borderColor: "rgba(255,255,255,.10)",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        localization: {
          priceFormatter: (price: number) => price.toFixed(2),
          timeFormatter: (time: unknown) => {
            if (typeof time === "number") {
              return new Date(time * 1000).toLocaleTimeString("en-US", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
              });
            }
            return "";
          },
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        wickUpColor: "#30d158",
        upColor: "#30d158",
        wickDownColor: "#ff5b5b",
        downColor: "#ff5b5b",
        borderVisible: false,
      });
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        color: "rgba(255,255,255,.26)",
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });

      chartApiRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;

      const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      });
      ro.observe(container);
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });

      return () => ro.disconnect();
    };

    let cleanup: void | (() => void);
    void init().then((fn) => { cleanup = fn; });

    return () => {
      canceled = true;
      cleanup?.();
      chartApiRef.current?.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !volumeSeries || !chart) return;

    const candleData: CandlestickData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));
    const volumeData: HistogramData[] = rows.map((row) => {
      const up = row.close >= row.open;
      // Brighter bar when volume runs hot vs the 14-day slot average.
      const hot = row.avg14 && row.avg14 > 0 ? row.volume / row.avg14 >= 1.5 : false;
      const a = hot ? 0.7 : 0.42;
      return {
        time: toChartTime(row.timestamp),
        value: row.volume,
        color: up ? `rgba(48, 209, 88, ${a})` : `rgba(255, 91, 91, ${a})`,
      };
    });

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    // Fit once on first data load only — never re-center on live updates so the
    // user's pan/zoom is preserved.
    if (!didFitRef.current && candleData.length) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
    }
  }, [rows]);

  // Draw GEX level lines (Call Wall / Put Wall / Flip / MVC) on the candle series,
  // converting SPX-point levels to ES via the live basis (esFut - spx).
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Clear previous lines.
    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];

    const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
    const toEs = (spxLevel: number | null) => (spxLevel != null ? spxLevel + basis : null);

    const defs: Array<{ price: number | null; color: string; title: string }> = [
      { price: toEs(levels.callWall), color: "#30d158", title: "Call Wall" },
      { price: toEs(levels.putWall),  color: "#ff5b5b", title: "Put Wall" },
      { price: toEs(levels.gexFlip),  color: "#f5c518", title: "Flip" },
      { price: toEs(levels.mvc),      color: "#4aa3ff", title: "MVC" },
    ];

    for (const d of defs) {
      if (d.price == null || !(d.price > 0)) continue;
      const pl = series.createPriceLine({
        price: d.price,
        color: d.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: d.title,
      });
      priceLinesRef.current.push(pl);
    }
  }, [levels]);

  return (
    <div className="flex h-full flex-col" style={{ background: "linear-gradient(180deg,#06080d,#0b1018)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "#ff5b5b" }}>ES 5m Candles</div>
          <div className="mt-1 text-xs text-white/70">5m ES candles from Postgres, merged live over /ws/gex.</div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded border px-2 py-1" style={{ borderColor: "rgba(255,255,255,.12)", color: status === "live" ? "#30d158" : "#94a3b8" }}>
            {status.toUpperCase()}
          </span>
          <span className="rounded border px-2 py-1 text-white/70" style={{ borderColor: "rgba(255,255,255,.12)" }}>
            {`${rows.length} candles`}
          </span>
          <button onClick={() => void refresh()} className="rounded border px-3 py-1 text-xs" style={{ borderColor: "rgba(255,255,255,.12)", color: "#ffb4b4" }}>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-3">
        <div className="rounded-xl border p-4" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Last Close</div>
          <div className="mt-2 text-3xl font-black text-white">{lastCandle ? lastCandle.close.toFixed(2) : "—"}</div>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Last Volume</div>
          <div className="mt-2 text-3xl font-black text-white">{lastCandle ? lastCandle.volume.toLocaleString("en-US") : "—"}</div>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Updated</div>
          <div className="mt-2 text-3xl font-black text-white">{lastCandle ? etClock(lastCandle.timestamp) : "—"}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-4 pb-1 text-xs">
        {(() => {
          const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
          const es = (v: number | null) => (v != null ? (v + basis).toFixed(2) : "—");
          const Chip = ({ c, label, v }: { c: string; label: string; v: number | null }) => (
            <span className="flex items-center gap-1.5">
              <span style={{ display: "inline-block", width: 14, height: 0, borderTop: `2px dashed ${c}` }} />
              <span className="text-white/55">{label}</span>
              <span className="font-mono font-bold" style={{ color: c }}>{es(v)}</span>
            </span>
          );
          return (
            <>
              <Chip c="#30d158" label="Call Wall" v={levels.callWall} />
              <Chip c="#ff5b5b" label="Put Wall" v={levels.putWall} />
              <Chip c="#f5c518" label="Flip" v={levels.gexFlip} />
              <Chip c="#4aa3ff" label="MVC" v={levels.mvc} />
              <span className="text-white/35">basis {basis ? (basis > 0 ? "+" : "") + basis.toFixed(2) : "—"}</span>
            </>
          );
        })()}
      </div>

      <div className="flex-1 px-4 pb-4">
        <div className="relative h-full min-h-[520px] overflow-hidden rounded-2xl border" style={{ borderColor: "rgba(255,255,255,.08)", background: "radial-gradient(circle at top, rgba(255,91,91,.12), rgba(6,8,13,.96) 50%)" }}>
          <div ref={chartRef} className="absolute inset-0" />
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
              {connected ? "Waiting for live 5m ES candles" : "Loading candles…"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
