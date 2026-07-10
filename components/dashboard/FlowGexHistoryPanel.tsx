"use client";

/**
 * components/dashboard/FlowGexHistoryPanel.tsx
 *
 * The actual Flow GEX History content — no <PageShell> wrapper, so it can be
 * mounted either as its own route (app/flow-gex-history/page.tsx, wrapped in
 * PageShell there) or as a tab inside another PageShell-wrapped page (the
 * Test Lab's "Flow GEX History" tab in app/test/page.tsx). Single source of
 * truth for both call sites.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorType, CrosshairMode, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
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

// NY regular session bounds, ET wall-clock minutes: 09:30–16:30. p.timeEt is
// already ET "HH:MM" (server to_char), so no timezone math is needed here.
const SESSION_START_MIN = 9 * 60 + 30;
const SESSION_END_MIN = 16 * 60 + 30;
function inNySession(timeEt: string): boolean {
  const [h, m] = timeEt.split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= SESSION_START_MIN && mins <= SESSION_END_MIN;
}

export function FlowGexHistoryPanel() {
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
      // NY session only (09:30–16:30 ET) — drop overnight/Globex tape so the
      // chart + rail read as the cash session. Cumulative call/put net still
      // carries overnight inventory into the first in-session point.
      for (const k of Object.keys(json.seriesByStrike ?? {})) {
        json.seriesByStrike[k] = json.seriesByStrike[k].filter((p) => inNySession(p.timeEt));
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

  // Rail rows: strikes sorted lowest→highest (left→right, reads like a price
  // axis), each carrying its line color, latest Flow GEX value, and a
  // magnitude bar scaled against the window's largest |value|.
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
    rows.sort((a, b) => a.strike - b.strike);
    return rows;
  }, [data]);

  const maxAbsLatest = useMemo(
    () => Math.max(1, ...railRows.map((r) => Math.abs(r.latest ?? 0))),
    [railRows]
  );

  return (
    <Card
      accent="cyan"
      title="Flow GEX history"
      subtitle={
        data
          ? `${data.expiration || "—"} · spot ${data.spot ? data.spot.toFixed(2) : "--"} · ${data.strikes.length} strikes (±20 of ATM)`
          : "Loading…"
      }
      padding={16}
    >
      {error && (
        <div style={{ fontSize: 12, color: HOME_THEME.red, marginBottom: 10 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <button style={homeButtonStyle} onClick={trigger}>{label}</button>
        <button style={homeButtonStyle} onClick={allOn}>All on</button>
        <button style={homeButtonStyle} onClick={allOff}>All off</button>
      </div>

      <div ref={chartContainerRef} style={{ width: "100%", height: 420, position: "relative" }} />

      {/* GEX flow rail — one vertical bar per strike, directly under the
          chart, same left→right strike order. Bar height/color/direction
          (up = positive, down = negative from the zero line) always reflects
          the strike's latest value regardless of on/off state; clicking a
          column only toggles that strike's line on the chart above — the
          bar itself never dims, so the rail keeps reading as "current
          positioning" even for strikes you've hidden. */}
      <div style={{ marginTop: 14, border: `1px solid ${HOME_THEME.border}`, borderRadius: 8, padding: "10px 6px 6px" }}>
        <div style={{ display: "flex", alignItems: "stretch", height: 130, position: "relative" }}>
          {/* zero baseline */}
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: HOME_THEME.border }} />
          {railRows.map(({ strike, color, isAtm, latest }) => {
            const on = !hidden.has(strike);
            const pos = (latest ?? 0) >= 0;
            const pct = latest == null ? 0 : Math.min(100, (Math.abs(latest) / maxAbsLatest) * 100);
            const barColor = pos ? HOME_THEME.cyan : HOME_THEME.red;
            return (
              <button
                key={strike}
                onClick={() => toggleStrike(strike)}
                title={`${strike}${isAtm ? " (ATM)" : ""} — ${latest == null ? "no data" : fmtMoney(latest)}${on ? "" : " (line hidden)"}`}
                style={{
                  flex: 1,
                  minWidth: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  border: "none",
                  borderLeft: isAtm ? `1px solid ${HOME_THEME.border}` : "none",
                  borderRight: isAtm ? `1px solid ${HOME_THEME.border}` : "none",
                  background: isAtm ? "rgba(255,255,255,0.04)" : "transparent",
                  cursor: "pointer",
                  padding: 0,
                  position: "relative",
                }}
              >
                {/* diverging bar: top half of the column = positive region, grows
                    UP from the center line; bottom half = negative region, grows
                    DOWN from the center line. pct is already 0-100 against the
                    window's max, so it maps 1:1 onto each half's own height. */}
                <div style={{ position: "absolute", left: "20%", right: "20%", top: 0, height: "50%", display: "flex", alignItems: "flex-end" }}>
                  <div style={{ width: "100%", height: `${pos ? pct : 0}%`, background: barColor, opacity: 0.85, borderRadius: "2px 2px 0 0" }} />
                </div>
                <div style={{ position: "absolute", left: "20%", right: "20%", top: "50%", height: "50%", display: "flex", alignItems: "flex-start" }}>
                  <div style={{ width: "100%", height: `${!pos ? pct : 0}%`, background: barColor, opacity: 0.85, borderRadius: "0 0 2px 2px" }} />
                </div>
                {/* on/off indicator — small dot above the bar, does not affect the bar itself */}
                <span style={{
                  position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)",
                  width: 10, height: 10, borderRadius: "50%",
                  background: on ? color.stroke : "transparent",
                  border: `2px solid ${color.stroke}`,
                  boxShadow: on ? `0 0 5px ${color.stroke}` : "none",
                }} />
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", marginTop: 4 }}>
          {railRows.map(({ strike, isAtm }) => (
            <div
              key={strike}
              style={{
                flex: 1,
                minWidth: 20,
                textAlign: "center",
                fontSize: 16,
                fontFamily: "var(--font-mono)",
                color: isAtm ? HOME_THEME.cyan : HOME_THEME.text,
                fontWeight: isAtm ? 800 : 600,
                opacity: isAtm ? 1 : 0.85,
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                height: 72,
                overflow: "hidden",
              }}
            >
              {strike}
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10, color: HOME_THEME.muted, opacity: 0.6, marginTop: 10 }}>
        Approximation: each strike uses its latest known gamma, not gamma-at-that-instant. Rail is sorted by strike, highest at top.
      </div>
    </Card>
  );
}
