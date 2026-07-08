"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorType, CrosshairMode, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useRefreshButton } from "@/hooks/useRefreshButton";

// ── Types (mirrors server-v2/state/flow-gex-history.js's response shape) ──────

interface FlowGexPoint {
  ts: number; // epoch seconds
  timeEt: string;
  callNet: number;
  putNet: number;
  flowGex: number | null;
}

interface FlowGexHistoryResponse {
  date: string;
  expiration: string;
  spot: number;
  strikes: number[];
  seriesByStrike: Record<string, FlowGexPoint[]>;
}

// ── Color palette — stable hue per index so a strike keeps its color across
//    refreshes (the strike list itself can shift as spot moves the window). ──

function colorForIndex(i: number, total: number): { stroke: string; bg: string } {
  const hue = Math.round((i / Math.max(1, total)) * 360);
  return { stroke: `hsl(${hue}, 70%, 60%)`, bg: `hsla(${hue}, 70%, 60%, 0.13)` };
}

function fmtMoney(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
}

export default function FlowGexHistoryPage() {
  const [data, setData] = useState<FlowGexHistoryResponse | null>(null);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<number, ISeriesApi<"Line">>>(new Map());

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/proxy/flow-gex-history", { cache: "no-store" });
      const json = (await res.json()) as FlowGexHistoryResponse;
      if (!json || !Array.isArray(json.strikes)) {
        setError("No response from /proxy/flow-gex-history");
        return;
      }
      if (!json.strikes.length) {
        setError("No tape recorded for any strike today yet.");
      }
      setData(json);
      // Default: every returned strike visible. Only reset the visible set when
      // the strike window actually changes (spot moved far enough that the
      // ±20 window shifted) — otherwise a manual refresh would silently
      // re-show strikes the user had clicked off.
      setVisible((prev) => {
        const nextStrikes = new Set(json.strikes);
        const sameWindow = prev.size > 0 && [...prev].every((s) => nextStrikes.has(s)) && prev.size === nextStrikes.size;
        return sameWindow ? prev : nextStrikes;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    }
  }, []);

  const { trigger, label } = useRefreshButton(load);

  // Initial load + poll every 60s (this is a reconstruction from Postgres, not
  // a push feed — a minute is plenty fresh for a history view).
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Chart lifecycle — created once.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
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
        tickMarkFormatter: (t: unknown) => {
          if (typeof t !== "number") return "";
          return new Date(t * 1000).toLocaleTimeString("en-US", {
            timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
          });
        },
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (price: number) => fmtMoney(price),
        timeFormatter: (time: unknown) => {
          if (typeof time !== "number") return "";
          return new Date(time * 1000).toLocaleTimeString("en-US", {
            timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
          });
        },
      },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
    };
  }, []);

  // Rebuild series whenever fresh data arrives. Strikes list changes shape
  // (window follows spot), so it's simplest to fully reconcile: drop series
  // for strikes no longer present, add series for new ones, update the rest.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data) return;

    const nextStrikes = new Set(data.strikes);
    for (const [strike, series] of seriesRef.current) {
      if (!nextStrikes.has(strike)) {
        chart.removeSeries(series);
        seriesRef.current.delete(strike);
      }
    }

    data.strikes.forEach((strike, i) => {
      const points = (data.seriesByStrike[String(strike)] ?? [])
        .filter((p) => p.flowGex != null)
        .map((p): LineData => ({ time: p.ts as UTCTimestamp, value: p.flowGex as number }));
      if (!points.length) return;

      let series = seriesRef.current.get(strike);
      const { stroke } = colorForIndex(i, data.strikes.length);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: stroke,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        seriesRef.current.set(strike, series);
      } else {
        series.applyOptions({ color: stroke });
      }
      series.setData(points);
      series.applyOptions({ visible: visible.has(strike) });
    });

    chart.timeScale().fitContent();
    // visible intentionally excluded — toggling is handled by the dedicated
    // effect below so a click doesn't force a full data re-set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Cheap path for visibility toggles — no data re-fetch/re-set, just flips
  // the series option.
  useEffect(() => {
    for (const [strike, series] of seriesRef.current) {
      series.applyOptions({ visible: visible.has(strike) });
    }
  }, [visible]);

  const toggleStrike = useCallback((strike: number) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(strike)) next.delete(strike);
      else next.add(strike);
      return next;
    });
  }, []);

  const allOn = useCallback(() => {
    if (!data) return;
    setVisible(new Set(data.strikes));
  }, [data]);

  const allOff = useCallback(() => setVisible(new Set()), []);

  const strikeChips = useMemo(() => {
    if (!data) return [];
    return data.strikes.map((strike, i) => ({
      strike,
      color: colorForIndex(i, data.strikes.length),
      isAtm: data.strikes.length
        ? strike === data.strikes.reduce((best, s) => (Math.abs(s - data.spot) < Math.abs(best - data.spot) ? s : best), data.strikes[0])
        : false,
    }));
  }, [data]);

  return (
    <PageShell>
      <Card
        accent="cyan"
        title="Flow GEX history"
        subtitle={
          data
            ? `${data.expiration || "—"} · spot ${data.spot ? data.spot.toFixed(2) : "--"} · ${data.strikes.length} strikes (±20 of ATM) · reconstructed from flow_prints + gamma snapshots`
            : "Loading…"
        }
        padding={16}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <button style={homeButtonStyle} onClick={trigger}>{label}</button>
          <button style={homeButtonStyle} onClick={allOn}>All on</button>
          <button style={homeButtonStyle} onClick={allOff}>All off</button>
          <span style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.6, marginLeft: "auto" }}>
            Approximation: each strike uses its latest known gamma, not gamma-at-that-instant.
          </span>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: HOME_THEME.red, marginBottom: 10 }}>{error}</div>
        )}

        <div ref={chartContainerRef} style={{ width: "100%", height: 420, position: "relative" }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
          {strikeChips.map(({ strike, color, isAtm }) => {
            const on = visible.has(strike);
            return (
              <button
                key={strike}
                onClick={() => toggleStrike(strike)}
                title={on ? "Click to hide" : "Click to show"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: `1px solid ${on ? color.stroke : HOME_THEME.border}`,
                  background: on ? color.bg : "rgba(255,255,255,0.03)",
                  color: on ? HOME_THEME.text : HOME_THEME.muted,
                  opacity: on ? 1 : 0.45,
                  fontSize: 11,
                  fontWeight: isAtm ? 800 : 600,
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color.stroke, flexShrink: 0 }} />
                {strike}
                {isAtm ? " · ATM" : ""}
              </button>
            );
          })}
        </div>
      </Card>
    </PageShell>
  );
}
