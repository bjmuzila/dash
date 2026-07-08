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
  // Strikes the user has explicitly turned OFF. Kept separate from the fetched
  // strike list (which shifts every poll as spot moves the ±20 window) so a
  // refresh/poll never resets anyone's toggles — a strike only starts hidden
  // if it's in this set, and this set is only ever touched by clicking.
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<number, ISeriesApi<"Line">>>(new Map());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

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
  // Visibility is read from hiddenRef (not the `hidden` state directly) so
  // this effect doesn't need `hidden` as a dependency — a toggle click is
  // handled by the cheap effect below instead of re-running this one.
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
      series.applyOptions({ visible: !hiddenRef.current.has(strike) });
    });

    chart.timeScale().fitContent();
  }, [data]);

  // Cheap path for visibility toggles — no data re-fetch/re-set, just flips
  // the series option on the strikes currently plotted.
  useEffect(() => {
    for (const [strike, series] of seriesRef.current) {
      series.applyOptions({ visible: !hidden.has(strike) });
    }
  }, [hidden]);

  const toggleStrike = useCallback((strike: number) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(strike)) next.delete(strike);
      else next.add(strike);
      return next;
    });
  }, []);

  const allOn = useCallback(() => setHidden(new Set()), []);
  const allOff = useCallback(() => {
    if (!data) return;
    setHidden(new Set(data.strikes));
  }, [data]);

  // Rail rows: strikes sorted highest-first (top of the rail = highest strike,
  // matching every other strike-indexed table in the app), each carrying its
  // line color, latest Flow GEX value, and a magnitude bar scaled against the
  // window's largest |value| so the rail visually "matches up with" the chart.
  const railRows = useMemo(() => {
    if (!data) return [];
    const atm = data.strikes.length
      ? data.strikes.reduce((best, s) => (Math.abs(s - data.spot) < Math.abs(best - data.spot) ? s : best), data.strikes[0])
      : null;
    const indexByStrike = new Map(data.strikes.map((s, i) => [s, i]));
    const rows = data.strikes.map((strike) => {
      const points = data.seriesByStrike[String(strike)] ?? [];
      const last = [...points].reverse().find((p) => p.flowGex != null) ?? null;
      return {
        strike,
        color: colorForIndex(indexByStrike.get(strike) ?? 0, data.strikes.length),
        isAtm: strike === atm,
        latest: last ? last.flowGex : null,
      };
    });
    rows.sort((a, b) => b.strike - a.strike);
    return rows;
  }, [data]);

  const maxAbsLatest = useMemo(
    () => Math.max(1, ...railRows.map((r) => Math.abs(r.latest ?? 0))),
    [railRows]
  );

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
        {error && (
          <div style={{ fontSize: 12, color: HOME_THEME.red, marginBottom: 10 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          <div ref={chartContainerRef} style={{ flex: 1, minWidth: 0, height: 460, position: "relative" }} />

          {/* GEX flow rail — buttons live at its top, rows below match up 1:1
              with the strikes plotted on the chart (same order, same colors). */}
          <div style={{ width: 190, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <button style={{ ...homeButtonStyle, padding: "5px 8px" }} onClick={trigger}>{label}</button>
              <button style={{ ...homeButtonStyle, padding: "5px 8px" }} onClick={allOn}>All on</button>
              <button style={{ ...homeButtonStyle, padding: "5px 8px" }} onClick={allOff}>All off</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: `1px solid ${HOME_THEME.border}`, borderRadius: 8 }}>
              {railRows.map(({ strike, color, isAtm, latest }) => {
                const on = !hidden.has(strike);
                const pos = (latest ?? 0) >= 0;
                const barPct = latest == null ? 0 : Math.min(100, (Math.abs(latest) / maxAbsLatest) * 100);
                return (
                  <button
                    key={strike}
                    onClick={() => toggleStrike(strike)}
                    title={on ? "Click to hide" : "Click to show"}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "5px 8px",
                      border: "none",
                      borderBottom: `1px solid ${HOME_THEME.border}`,
                      background: isAtm ? "rgba(255,255,255,0.05)" : "transparent",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {/* Strike label + dot reflect on/off (dot hollows out when the
                        line is hidden) — but the value + bar below stay at full
                        strength always, so the rail keeps reading as "current
                        positioning" even for strikes you've turned off the chart. */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: isAtm ? 800 : 600, color: on ? HOME_THEME.text : HOME_THEME.muted, opacity: on ? 1 : 0.55 }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                          background: on ? color.stroke : "transparent",
                          border: `1.5px solid ${color.stroke}`,
                          boxSizing: "border-box",
                        }} />
                        {strike}{isAtm ? " ·ATM" : ""}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: latest == null ? HOME_THEME.muted : pos ? HOME_THEME.cyan : HOME_THEME.red, opacity: latest == null ? 0.5 : 1 }}>
                        {latest == null ? "--" : fmtMoney(latest)}
                      </span>
                    </div>
                    <div style={{ marginTop: 3, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${barPct}%`, background: pos ? HOME_THEME.cyan : HOME_THEME.red, opacity: 0.75 }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.6, marginTop: 10 }}>
          Approximation: each strike uses its latest known gamma, not gamma-at-that-instant. Rail is sorted by strike, highest at top.
        </div>
      </Card>
    </PageShell>
  );
}
