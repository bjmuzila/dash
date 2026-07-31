"use client";

// VolGexFlowPanel — intraday flow of NET VOL GEX for today's session.
//
// Used in two places, same component:
//   • app/home/HomeClient.tsx     → "Vol GEX Flow" tab beside Economic Calendar
//   • app/test/page.tsx           → draggable card on the GEX Levels tab
//
// Data: GET /proxy/gex-vol-flow (server-with-proxy.js), which buckets
// option_strike_gex_history server-side — last reading per (expiry, strike) per
// bucket, summed. Front expiry by default, derived from the newest snapshot
// rather than the calendar. Polled; the endpoint caches 20s and the recorder
// only writes ~1/min, so this is cheap.
//
// Why a Baseline series: net vol GEX is a POLARITY measure — the sign is the
// signal (positive = flow adding long gamma / dampening, negative = short
// gamma / amplifying). A baseline series splits the fill at zero natively, so
// the sign is read from color and side without a legend lookup.
//
// Why two charts and not one with two scales: spot and GEX are different units.
// A dual-axis overlay implies a crossing relationship that isn't there and lets
// the axis choice manufacture correlation. Two stacked panels sharing an x-axis
// and a crosshair show the same alignment honestly.
//
// Theme: HOME_THEME tokens only — no ad-hoc hex.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaselineSeries, ColorType, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { HOME_THEME } from "@/components/shared/homeTheme";

const C = HOME_THEME;

// C.green is the dashboard's light blue — the same token the Levels strip uses
// for a positive Net GEX, so "positive gamma" reads identically across the app.
const POS = C.green;
const NEG = C.red;

const POLL_MS = 30_000;
const BIN_SEC = 300;

export type VolFlowPoint = {
  ts: number;
  spot: number;
  volGex: number;
  oiGex: number;
  combined: number;
  dVol: number | null;
  strikes: number;
};

type VolFlowResponse = {
  ok?: boolean;
  reason?: string;
  scope?: string;
  expiry?: string | null;
  binSec?: number;
  points?: VolFlowPoint[];
};

// Signed, magnitude-scaled. Mirrors fmtMoneyB on the home Levels strip so the
// tab and the strip never disagree about what "12.4B" means.
function fmtGex(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

function etTime(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VolGexFlowPanel({
  showSpot = true,
  scope = "front",
}: {
  showSpot?: boolean;
  scope?: "front" | "all";
}) {
  const [points, setPoints] = useState<VolFlowPoint[]>([]);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/proxy/gex-vol-flow?bin=${BIN_SEC}&scope=${scope}`, { cache: "no-store" });
      const j = (await r.json()) as VolFlowResponse;
      if (j?.ok === false) {
        setErr(j.reason === "no-db" ? "History DB unavailable" : "Feed unavailable");
        setPoints([]);
      } else {
        setPoints(Array.isArray(j?.points) ? j.points : []);
        setExpiry(j?.expiry ?? null);
        setErr(null);
      }
      setUpdatedAt(Date.now());
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    tick();
    const id = setInterval(tick, POLL_MS);
    // Refresh immediately when the tab comes back — a backgrounded tab throttles
    // the interval, so returning to it would otherwise show a stale last bucket.
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // ── Derived stats for the cards ──
  const stats = useMemo(() => {
    if (!points.length) return null;
    const vals = points.map((p) => p.volGex);
    const last = points[points.length - 1];
    const hiIdx = vals.reduce((m, v, i) => (v > vals[m] ? i : m), 0);
    const loIdx = vals.reduce((m, v, i) => (v < vals[m] ? i : m), 0);
    // Zero crossings — each one is a regime change between dampening and
    // amplifying, which is the thing worth counting on this series.
    let flips = 0;
    for (let i = 1; i < vals.length; i++) {
      if ((vals[i - 1] < 0 && vals[i] >= 0) || (vals[i - 1] >= 0 && vals[i] < 0)) flips++;
    }
    const biggest = points.reduce<VolFlowPoint | null>(
      (m, p) => (p.dVol != null && (m == null || Math.abs(p.dVol) > Math.abs(m.dVol as number)) ? p : m),
      null
    );
    return {
      last,
      high: { v: vals[hiIdx], at: points[hiIdx].ts },
      low: { v: vals[loIdx], at: points[loIdx].ts },
      open: vals[0],
      flips,
      biggest,
    };
  }, [points]);

  // ── Charts ──
  const gexBoxRef = useRef<HTMLDivElement | null>(null);
  const spotBoxRef = useRef<HTMLDivElement | null>(null);
  const gexChartRef = useRef<IChartApi | null>(null);
  const spotChartRef = useRef<IChartApi | null>(null);
  const gexSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  // The charts are built once and never rebuilt on new data (rebuilding would
  // reset the user's zoom every poll), so the crosshair handlers must read
  // points through a ref — a closure over the state would stay pinned to the
  // empty array captured at mount and the sync would silently never fire.
  const pointsRef = useRef<VolFlowPoint[]>([]);
  useEffect(() => { pointsRef.current = points; }, [points]);

  useEffect(() => {
    const boxes: Array<{ box: HTMLDivElement | null; kind: "gex" | "spot" }> = [
      { box: gexBoxRef.current, kind: "gex" },
      { box: showSpot ? spotBoxRef.current : null, kind: "spot" },
    ];
    const made: Array<{ chart: IChartApi; ro: ResizeObserver; raf: number }> = [];

    for (const { box, kind } of boxes) {
      if (!box) continue;
      box.innerHTML = "";
      const chart = createChart(box, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: C.text,
          fontFamily: "Inter, system-ui, sans-serif",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,.05)" },
          horzLines: { color: "rgba(255,255,255,.05)" },
        },
        rightPriceScale: { visible: true, borderColor: C.border },
        leftPriceScale: { visible: false },
        handleScale: false,
        handleScroll: false,
        crosshair: { mode: 0 },
        timeScale: {
          borderColor: C.border,
          timeVisible: true,
          secondsVisible: false,
          // The spot panel sits directly under the GEX panel and shares its
          // x-axis, so only the bottom one draws time labels.
          visible: kind === "spot" || !showSpot,
          tickMarkFormatter: (time: unknown) => (typeof time === "number" ? etTime(time) : ""),
        },
        localization: {
          priceFormatter: (p: number) => (kind === "gex" ? fmtGex(p, 1) : p.toFixed(2)),
          timeFormatter: (time: unknown) => (typeof time === "number" ? etTime(time) : ""),
        },
      });

      if (kind === "gex") {
        gexSeriesRef.current = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: 0 },
          topLineColor: POS,
          topFillColor1: "rgba(142,202,230,0.32)",
          topFillColor2: "rgba(142,202,230,0.02)",
          bottomLineColor: NEG,
          bottomFillColor1: "rgba(239,68,68,0.02)",
          bottomFillColor2: "rgba(239,68,68,0.32)",
          lineWidth: 2,
          priceLineVisible: false,
        });
        // Bottom margin keeps the lowest price tick off the canvas edge, where
        // lightweight-charts would clip the label in half.
        chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.14 } });
        gexChartRef.current = chart;
      } else {
        spotSeriesRef.current = chart.addSeries(LineSeries, {
          color: "rgba(255,255,255,0.72)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.18, bottom: 0.14 } });
        spotChartRef.current = chart;
      }

      let lastW = 0, lastH = 0;
      const applySize = () => {
        const w = box.clientWidth, h = box.clientHeight;
        if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
          lastW = w; lastH = h;
          chart.applyOptions({ width: w, height: h });
        }
      };
      const ro = new ResizeObserver(applySize);
      ro.observe(box);
      let raf = 0, tries = 0;
      const pump = () => {
        applySize();
        if ((lastW === 0 || lastH === 0) && tries++ < 120) raf = requestAnimationFrame(pump);
      };
      raf = requestAnimationFrame(pump);
      made.push({ chart, ro, raf });
    }

    // Sync the two panels: logical range (so zoom/fit agree) and crosshair (so
    // reading one panel reads the other). A guard flag stops the echo.
    let syncing = false;
    const a = gexChartRef.current, b = spotChartRef.current;
    const unsubs: Array<() => void> = [];
    if (a && b) {
      const link = (from: IChartApi, to: IChartApi) => {
        const onRange = (r: unknown) => {
          if (syncing || !r) return;
          syncing = true;
          try { to.timeScale().setVisibleLogicalRange(r as { from: number; to: number }); } catch { /* range not ready */ }
          syncing = false;
        };
        from.timeScale().subscribeVisibleLogicalRangeChange(onRange);
        unsubs.push(() => from.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));
      };
      link(a, b);
      link(b, a);

      const crossA = (param: { time?: unknown }) => {
        if (!param?.time || !spotSeriesRef.current) { b.clearCrosshairPosition(); return; }
        const pt = pointsRef.current.find((p) => Math.floor(p.ts / 1000) === param.time);
        if (pt) b.setCrosshairPosition(pt.spot, param.time as UTCTimestamp, spotSeriesRef.current);
      };
      const crossB = (param: { time?: unknown }) => {
        if (!param?.time || !gexSeriesRef.current) { a.clearCrosshairPosition(); return; }
        const pt = pointsRef.current.find((p) => Math.floor(p.ts / 1000) === param.time);
        if (pt) a.setCrosshairPosition(pt.volGex, param.time as UTCTimestamp, gexSeriesRef.current);
      };
      a.subscribeCrosshairMove(crossA);
      b.subscribeCrosshairMove(crossB);
      unsubs.push(() => { a.unsubscribeCrosshairMove(crossA); b.unsubscribeCrosshairMove(crossB); });
    }

    return () => {
      for (const u of unsubs) { try { u(); } catch { /* chart already gone */ } }
      for (const { chart, ro, raf } of made) {
        cancelAnimationFrame(raf);
        ro.disconnect();
        chart.remove();
      }
      gexChartRef.current = null;
      spotChartRef.current = null;
      gexSeriesRef.current = null;
      spotSeriesRef.current = null;
    };
  }, [showSpot]);

  useEffect(() => {
    if (!points.length) return;
    const t = (p: VolFlowPoint) => Math.floor(p.ts / 1000) as UTCTimestamp;
    gexSeriesRef.current?.setData(points.map((p) => ({ time: t(p), value: p.volGex })));
    spotSeriesRef.current?.setData(points.map((p) => ({ time: t(p), value: p.spot })));
    try {
      gexChartRef.current?.timeScale().fitContent();
      spotChartRef.current?.timeScale().fitContent();
    } catch { /* not laid out yet */ }
  }, [points]);

  // ── Cards ──
  const cards = useMemo(() => {
    if (!stats) return [];
    const last = stats.last;
    return [
      { label: "Net Vol GEX", value: fmtGex(last.volGex), sub: etTime(Math.floor(last.ts / 1000)), color: last.volGex >= 0 ? POS : NEG },
      { label: "Δ Last Bucket", value: last.dVol == null ? "—" : `${last.dVol > 0 ? "+" : ""}${fmtGex(last.dVol)}`, sub: `${BIN_SEC / 60}m`, color: (last.dVol ?? 0) >= 0 ? POS : NEG },
      { label: "Session High", value: fmtGex(stats.high.v), sub: etTime(Math.floor(stats.high.at / 1000)), color: POS },
      { label: "Session Low", value: fmtGex(stats.low.v), sub: etTime(Math.floor(stats.low.at / 1000)), color: stats.low.v < 0 ? NEG : C.text },
      { label: "Sign Flips", value: String(stats.flips), sub: stats.flips === 0 ? "one regime" : "regime changes", color: stats.flips > 0 ? C.orange : C.cyan },
      { label: "Spot", value: last.spot ? last.spot.toFixed(2) : "—", sub: `${last.strikes} strikes`, color: C.cyan },
    ];
  }, [stats]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 10, padding: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.text }}>
          Net Vol GEX Flow
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.cyan, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 8px" }}>
          {expiry ? `EXP ${expiry}` : scope === "all" ? "ALL EXPIRIES" : "FRONT"}
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em" }}>
          {BIN_SEC / 60}m buckets · today ET
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {updatedAt && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>
              {etTime(Math.floor(updatedAt / 1000))}
            </span>
          )}
          <button
            onClick={() => void load()}
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.cyan, background: "rgba(33,158,188,0.10)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 6, flexShrink: 0 }}>
        {(cards.length ? cards : Array.from({ length: 6 }, () => null)).map((c, i) => (
          <div
            key={c?.label ?? i}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, background: "rgba(13,17,25,0.35)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", minWidth: 0 }}
          >
            <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, whiteSpace: "nowrap" }}>
              {c?.label ?? "—"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 800, color: c?.color ?? C.text, whiteSpace: "nowrap" }}>
              {c?.value ?? "—"}
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>{c?.sub ?? ""}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
        <div ref={gexBoxRef} style={{ flex: showSpot ? 2.2 : 1, minHeight: 0 }} />
        {showSpot && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", paddingLeft: 2, marginBottom: 2 }}>
              SPX Spot
            </span>
            <div ref={spotBoxRef} style={{ flex: 1, minHeight: 0 }} />
          </div>
        )}

        {(loading || err || (!points.length && !loading)) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,6,10,0.72)", borderRadius: 10, textAlign: "center", padding: 16 }}>
            <span style={{ fontSize: 12, color: err ? C.red : C.cyan, letterSpacing: "0.06em", fontWeight: 700 }}>
              {err
                ? err
                : loading
                  ? "Loading net vol GEX history…"
                  : "No snapshots recorded yet today"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
