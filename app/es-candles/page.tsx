"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, CandlestickData, HistogramData } from "lightweight-charts";

type Candle = {
  timestamp: number;
  date: string;
  slotKey: string;
  time?: string;
  symbol?: string;
  intervalMinutes?: number;
  source?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume?: number;
};

function todayET(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

function sortCandles(rows: Candle[]) {
  return [...rows].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey));
}

function slotLabel(c: Candle) {
  return c.slotKey.slice(11, 16) || c.time?.slice(0, 5) || "--:--";
}

function etClock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function etSlotKey(ts: number) {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const minute = String(Math.floor(Number(map.minute || "0") / 5) * 5).padStart(2, "0");
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${minute}`;
}

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

export default function EsCandlesPage() {
  const [rows, setRows] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rowMapRef = useRef<Map<string, Candle>>(new Map());
  const lastSaveRef = useRef(0);

  const loadCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/snapshots/candles?date=${todayET()}&limit=4000`, { cache: "no-store" });
      const json = await res.json();
      const data = Array.isArray(json.rows) ? (json.rows as Candle[]) : [];
      const sorted = sortCandles(data);
      rowMapRef.current = new Map(sorted.map((row) => [row.slotKey, row]));
      setRows(sorted);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCandles();
  }, [loadCandles]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL
      ? `${process.env.NEXT_PUBLIC_WS_URL}/ws/dxlink`
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/dxlink`;
    const ws = new WebSocket(wsUrl);
    const feedTypes = { "/ES{=5m}": ["Candle"], "/ES:XCME{=5m}": ["Candle"] } as Record<string, string[]>;

    ws.onopen = () => {
      setStatus("live");
      try {
        ws.send(JSON.stringify({
          type: "subscribe",
          symbols: ["/ES{=5m}", "/ES:XCME{=5m}"],
          feedTypesBySymbol: feedTypes,
        }));
      } catch {}
      fetch("/api/proxy/dxlink-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: ["/ES{=5m}", "/ES:XCME{=5m}"],
          feedTypesBySymbol: feedTypes,
        }),
      }).catch(() => {});
    };

    ws.onmessage = async (e) => {
      try {
        const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const items = Array.isArray(msg?.data) ? msg.data : [];
        if (msg?.type !== "FEED_DATA" || !items.length) return;

        const nextMap = new Map(rowMapRef.current);
        let changed = false;

        for (const raw of items) {
          const candle = raw as Record<string, unknown>;
          if (String(candle.eventType ?? "") !== "Candle") continue;
          const sym = String(candle.eventSymbol ?? "/ES");
          const ts = Number(candle.time ?? candle.eventTime ?? 0);
          const open = Number(candle.open ?? 0);
          const high = Number(candle.high ?? 0);
          const low = Number(candle.low ?? 0);
          const close = Number(candle.close ?? 0);
          const volume = Number(candle.volume ?? 0);
          if (!(ts > 0) || !(open > 0) || !(high > 0) || !(low > 0) || !(close > 0)) continue;
          const slotKey = etSlotKey(ts);
          const row: Candle = {
            timestamp: ts,
            date: slotKey.slice(0, 10),
            slotKey,
            time: slotKey.slice(11),
            symbol: sym,
            intervalMinutes: 5,
            source: "dxlink",
            open,
            high,
            low,
            close,
            volume,
            avgVolume: Number(candle.avgVolume ?? 0),
          };
          nextMap.set(row.slotKey, row);
          changed = true;
        }

        if (!changed) return;
        const sorted = sortCandles([...nextMap.values()]);
        rowMapRef.current = nextMap;
        setRows(sorted);

        const now = Date.now();
        if (now - lastSaveRef.current >= 5000) {
          lastSaveRef.current = now;
          fetch("/api/snapshots/candles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sorted.filter((row) => Number(row.volume || 0) > 0)),
          }).catch(() => {});
        }
      } catch {
        // keep live view resilient
      }
    };

    ws.onerror = () => setStatus("err");
    ws.onclose = () => setStatus("idle");
    return () => ws.close();
  }, []);

  useEffect(() => {
    const id = setInterval(() => void loadCandles(), 30_000);
    return () => clearInterval(id);
  }, [loadCandles]);

  const lastCandle = rows[rows.length - 1];
  const maxVol = useMemo(() => Math.max(1, ...rows.map((r) => Number(r.volume || 0))), [rows]);

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
    const volumeData: HistogramData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      value: row.volume,
      color: row.close >= row.open ? "rgba(48, 209, 88, .45)" : "rgba(255, 91, 91, .45)",
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();
  }, [rows]);

  return (
    <div className="flex h-full flex-col" style={{ background: "linear-gradient(180deg,#06080d,#0b1018)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "#ff5b5b" }}>ES 5m Candles</div>
          <div className="mt-1 text-xs text-white/70">Live dxLink candle feed saved to SQLite and shown in the ES Candles table.</div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded border px-2 py-1" style={{ borderColor: "rgba(255,255,255,.12)", color: status === "live" ? "#30d158" : status === "err" ? "#ff5b5b" : "#94a3b8" }}>
            {status.toUpperCase()}
          </span>
          <span className="rounded border px-2 py-1 text-white/70" style={{ borderColor: "rgba(255,255,255,.12)" }}>
            {loading ? "Loading" : `${rows.length} candles`}
          </span>
          <button onClick={() => void loadCandles()} className="rounded border px-3 py-1 text-xs" style={{ borderColor: "rgba(255,255,255,.12)", color: "#ffb4b4" }}>
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
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-300">{error}</div>
          ) : rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">Waiting for live 5m ES candles</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
