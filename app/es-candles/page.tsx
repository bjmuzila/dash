"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, CandlestickData, HistogramData } from "lightweight-charts";
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

  const status = connected ? "live" : "offline";
  const lastCandle = rows[rows.length - 1];

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
    chart.timeScale().fitContent();
  }, [rows]);

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
