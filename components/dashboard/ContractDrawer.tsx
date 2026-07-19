"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ContractDrawer — the /flow tape's in-place whale expansion (variant D).
//
// Clicking a whale row (premium ≥ WHALE_FLOOR) expands this drawer directly
// underneath it, rather than opening a modal: the tape stays on screen, so you
// can compare the print you're inspecting against the ones around it.
//
// Contents:
//   • pan/zoomable contract chart (lightweight-charts, same as the GEX and ES
//     charts): close line, volume docked to the bottom, fill/peak/trough price
//     lines and a BOUGHT/SOLD marker on the fill bar
//   • since-fill tracking — the print's price vs current / peak / trough
//   • Vol/OI and IV·%OTM tiles, fed live from useContractStats
//
// Both timeframes are anchored to the alert — Today (its session) and All (its
// session → now) — and both are intraday. There is deliberately no 30D/90D:
// history from before the order printed says nothing about how the order did,
// and it drags the price axis until the interesting part is a flat line.
//
// Theme: HOME_THEME only — no color literals beyond the true-green buy accent
// (HOME_THEME.green is a light blue).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, createSeriesMarkers,
} from "lightweight-charts";
import type {
  IChartApi, ISeriesApi, ISeriesMarkersPluginApi, SeriesMarker, Time, UTCTimestamp, LineData, HistogramData,
} from "lightweight-charts";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import type { ContractStat } from "@/hooks/useContractStats";

const C = HOME_THEME;
const BULL = "#22c55e";
const BEAR = C.red;

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// Only two timeframes, both anchored to the print:
//   today = the alert's own session
//   all   = the alert's session → now
// There is deliberately no 30D/90D: history from before the order printed can't
// say anything about how the order did, and it drags the price axis to a scale
// that flattens the part you're actually looking at.
type TF = "today" | "all";
const TFS: { id: TF; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "all", label: "All" },
];

function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}
function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtNum(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toLocaleString();
}

export interface ContractDrawerProps {
  order: FlowOrder;
  /** Normalized underlying root (SPXW → SPX) — the API's chainTicker key. */
  ticker: string;
  stat: ContractStat | null;
  /** Live underlying spot, for the % OTM readout. 0 = not loaded yet. */
  liveSpot: number;
  onClose: () => void;
}

const etDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export default function ContractDrawer({ order, ticker, stat, liveSpot, onClose }: ContractDrawerProps) {
  const [tf, setTf] = useState<TF>("today");
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // The fill we're tracking: this print's own option price.
  const fillPrice = Number(order.price) || 0;

  // The alert's session — the anchor for BOTH timeframes. Note this is the
  // print's own date, not literally today: a tape loaded for a past date must
  // chart that date's session.
  const fillDate = etDate(order.ts);
  const todayEt = etDate(Date.now());
  // With a same-day print the two timeframes are identical, so don't offer All.
  const sameDay = fillDate === todayEt;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({
      ticker,
      expiry: order.expiration ?? "",
      strike: String(order.strike),
      type: order.type,
      start: fillDate,
      end: tf === "today" ? fillDate : todayEt,
    });
    fetch(`/proxy/option-history?${params}`)
      // The route puts the upstream Theta message in `error` on a 502 — surface
      // it instead of a bare "HTTP 502", which says nothing about what broke.
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ? String(j.error).slice(0, 160) : `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        if (cancelled) return;
        setBars(Array.isArray(j?.bars) ? j.bars : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e?.message || e));
        setBars([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ticker, order.expiration, order.strike, order.type, fillDate, todayEt, tf]);

  // ── Since-fill: current / peak / trough over bars AT OR AFTER the print.
  //
  // Both timeframes start AT the alert, so the series can't contain pre-order
  // history — but it can still contain the part of the session before the print
  // landed, so the >= fill-time filter stays. If nothing is at/after the fill
  // (an alert in the last bar of the day), fall back to the latest close and
  // flag it rather than reporting a peak that predates the order.
  const track = useMemo(() => {
    if (!bars.length || !(fillPrice > 0)) return null;
    const after = bars.filter((b) => b.time >= order.ts - 60_000);
    const noPostFill = !after.length;
    const scope = noPostFill ? bars.slice(-1) : after;
    let peak = -Infinity, trough = Infinity;
    for (const b of scope) {
      peak = Math.max(peak, b.high ?? b.close);
      trough = Math.min(trough, b.low ?? b.close);
    }
    const current = scope[scope.length - 1]?.close ?? 0;
    const pct = (p: number) => ((p - fillPrice) / fillPrice) * 100;
    return {
      current, peak, trough,
      currentPct: pct(current),
      peakPct: pct(peak),
      troughPct: pct(trough),
      noPostFill,
    };
  }, [bars, fillPrice, order.ts]);

  const dte = useMemo(() => {
    if (!order.expiration) return null;
    const exp = new Date(`${order.expiration}T00:00:00`);
    if (Number.isNaN(exp.getTime())) return null;
    return Math.round((exp.getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  }, [order.expiration]);

  const otmPct = liveSpot > 0 && order.strike
    ? ((order.type === "C" ? order.strike - liveSpot : liveSpot - order.strike) / liveSpot) * 100
    : null;

  const bull = (order.side === "buy") === (order.type === "C");

  const kpi: React.CSSProperties = {
    border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.35)", padding: "10px 12px",
  };
  const kl: React.CSSProperties = {
    fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted, opacity: 0.6,
  };
  const kv: React.CSSProperties = { fontSize: 17, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 4 };
  const note: React.CSSProperties = { fontSize: 12, color: C.muted, opacity: 0.5, fontFamily: "var(--font-mono)", marginTop: 2 };

  return (
    <div style={{
      borderBottom: `1px solid ${C.border}`,
      background: "rgba(33,158,188,0.05)",
      padding: "12px 20px",
    }}>
      {/* ── Drawer header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.text }}>
          ↳ {ticker} {order.strike.toLocaleString()}{order.type} · {order.expiration ?? "—"}
          {dte != null && <span style={{ color: C.muted, opacity: 0.6 }}> · {dte} DTE</span>}
          <span style={{ color: bull ? BULL : BEAR, marginLeft: 8 }}>{bull ? "▲ BULL" : "▼ BEAR"}</span>
        </span>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {TFS.map((t) => {
            // A same-day print has nothing beyond its own session, so All would
            // be a no-op button that redraws the identical chart.
            if (t.id === "all" && sameDay) return null;
            return (
              <button
                key={t.id}
                onClick={() => setTf(t.id)}
                title={t.id === "today" ? "The session this alert printed in" : `Since the alert (${fillDate}) → now`}
                style={{
                  fontSize: 12, fontWeight: 700, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  border: `1px solid ${tf === t.id ? C.cyan : C.border}`,
                  background: tf === t.id ? DOCK_THEME.activeTile : "rgba(0,0,0,0.4)",
                  color: tf === t.id ? C.cyan : C.text,
                }}
              >
                {t.label}
              </button>
            );
          })}
          <button
            onClick={onClose}
            title="Collapse"
            style={{
              fontSize: 12, fontWeight: 700, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
              border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.4)", color: C.muted,
            }}
          >
            ▲ Collapse
          </button>
        </div>
      </div>

      {/* ── Chart + KPI rail ──
          The chart cell is a flex column so the chart fills the card's FULL
          height — the KPI rail is the tallest thing in the row and the chart
          stretches to match it, instead of leaving dead space underneath. */}
      <div className="contract-drawer-grid" style={{ display: "grid", gridTemplateColumns: "1fr 230px", gap: 12, alignItems: "stretch" }}>
        <div style={{
          position: "relative",
          border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.35)",
          padding: 8, minHeight: 300, display: "flex", flexDirection: "column",
        }}>
          {/* CB Edge watermark. Sits above the canvas but ignores the mouse, so
              it can't eat pan/zoom drags. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cb-edge-logo.png"
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute", top: 12, left: 12, height: 26, width: "auto",
              opacity: 0.18, pointerEvents: "none", zIndex: 2, userSelect: "none",
            }}
          />
          {loading ? (
            <p style={{ fontSize: 12, color: C.muted, opacity: 0.6, padding: 20 }}>Loading contract history…</p>
          ) : err ? (
            <p style={{ fontSize: 12, color: C.red, padding: 20 }}>Contract history unavailable ({err}).</p>
          ) : !bars.length ? (
            <p style={{ fontSize: 12, color: C.muted, opacity: 0.6, padding: 20 }}>
              No traded bars for this contract {tf === "today" ? "this session" : "since the alert"}.
            </p>
          ) : (
            <ContractChart bars={bars} fillPrice={fillPrice} fillTs={order.ts} side={order.side} track={track} />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...kpi, borderColor: track && track.currentPct >= 0 ? "rgba(34,197,94,0.4)" : C.border }}>
            <div style={kl}>Since Fill</div>
            <div style={{ ...kv, color: !track ? C.muted : track.currentPct >= 0 ? BULL : BEAR }}>
              {track ? fmtPct(track.currentPct) : "—"}
            </div>
            <div style={note}>
              {fmtUsd(fillPrice)}{track ? ` → ${fmtUsd(track.current)}` : ""}
              {track?.noPostFill ? " · latest close" : ""}
            </div>
          </div>

          <div style={kpi}>
            <div style={kl}>Peak / Trough</div>
            <div style={{ ...kv, fontSize: 14 }}>
              <span style={{ color: BULL }}>{track ? fmtPct(track.peakPct) : "—"}</span>
              <span style={{ color: C.muted, opacity: 0.3 }}> / </span>
              <span style={{ color: BEAR }}>{track ? fmtPct(track.troughPct) : "—"}</span>
            </div>
            <div style={note}>
              {track
                ? track.noPostFill
                  ? "no bars after the alert yet"
                  : `${fmtUsd(track.peak)} / ${fmtUsd(track.trough)}`
                : "no bars since fill"}
            </div>
          </div>

          <div style={{ ...kpi, borderColor: "rgba(251,133,1,0.4)" }}>
            <div style={kl}>Vol / OI</div>
            <div style={{ ...kv, color: C.orange, fontSize: 14 }}>
              {stat?.vol != null && stat?.oi ? (stat.vol / stat.oi).toFixed(2) : "—"}
            </div>
            <div style={note}>{fmtNum(stat?.vol)} vol · {fmtNum(stat?.oi)} oi</div>
          </div>

          <div style={kpi}>
            <div style={kl}>IV · % OTM</div>
            <div style={{ ...kv, fontSize: 14 }}>
              {stat?.iv != null ? `${(stat.iv * 100).toFixed(1)}%` : "—"}
              <span style={{ color: C.muted, opacity: 0.3 }}> · </span>
              <span style={{ color: otmPct == null ? C.muted : otmPct >= 0 ? C.cyan : BEAR }}>
                {otmPct == null ? "—" : `${otmPct.toFixed(1)}%`}
              </span>
            </div>
            <div style={note}>
              {order.size.toLocaleString()} ct · {fmtUsd(order.premium)}
              {otmPct != null && otmPct < 0 ? " · now ITM" : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contract chart: close line + volume histogram docked to the bottom. ──
//
// lightweight-charts, NOT the hand-rolled SVG this started as — that couldn't
// pan or zoom, and a fixed-height <svg> left dead space under a card sized by the
// KPI rail. `autoSize` makes the chart track the container in BOTH axes, so it
// fills the card and the volume histogram genuinely sits at the card's bottom.
// Setup mirrors the /flow Net Premium chart (same v5 API, ET tick formatters,
// volume on its own overlay price scale) so the two behave identically.
//
// Guides come from bar HIGHS/LOWS while the line is CLOSES, so the peak guide
// sitting above the line is correct, not a bug — it's the intraday extreme.
function ContractChart({
  bars, fillPrice, fillTs, side, track,
}: {
  bars: Bar[];
  fillPrice: number;
  fillTs: number;
  side: "buy" | "sell";
  track: { peak: number; trough: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // "All" can span several sessions; a bare clock time would repeat 09:30 once
  // per day and read as nonsense.
  const multiDay = bars.length > 1 && bars[bars.length - 1].time - bars[0].time > 86_400_000;

  // ── Create once per mount. ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true, // tracks the container in both axes — fills the card
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
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        tickMarkFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleString("en-US", {
                timeZone: "America/New_York",
                ...(multiDay
                  ? { month: "short", day: "numeric", hour: "numeric" }
                  : { hour: "2-digit", minute: "2-digit" }),
              })
            : "",
      },
      localization: {
        priceFormatter: (p: number) => `$${p.toFixed(2)}`,
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleString("en-US", {
                timeZone: "America/New_York", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
              })
            : "",
      },
    });

    const price = chart.addSeries(LineSeries, {
      color: C.green, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
    // Volume on its own overlay scale, docked to the bottom ~20% of the card.
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false,
      priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });

    chartRef.current = chart;
    priceRef.current = price;
    volRef.current = vol;
    markersRef.current = createSeriesMarkers(price, []);

    return () => {
      markersRef.current = null;
      priceRef.current = null;
      volRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
    // multiDay only flips when the timeframe changes, which remounts the data
    // effect below; the formatter reads it at call time via closure on mount, so
    // rebuild the chart if it changes to keep axis labels honest.
  }, [multiDay]);

  // ── Data + overlays. ──
  useEffect(() => {
    const chart = chartRef.current, price = priceRef.current, vol = volRef.current;
    if (!chart || !price || !vol || !bars.length) return;

    const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
    // Theta can emit two bars inside one interval across a session boundary;
    // lightweight-charts throws on duplicate/unordered times, so dedupe.
    const seen = new Set<number>();
    const linePts: LineData[] = [];
    const volPts: HistogramData[] = [];
    for (const b of bars) {
      const t = sec(b.time);
      if (seen.has(t)) continue;
      seen.add(t);
      linePts.push({ time: t, value: b.close });
      volPts.push({
        time: t,
        value: b.volume ?? 0,
        color: Math.abs(b.time - fillTs) < 5 * 60_000 ? C.orange : "rgba(142,202,230,0.45)",
      });
    }
    price.setData(linePts);
    vol.setData(volPts);

    // Fill / peak / trough as real price lines so they stay pinned while panning.
    const lines = [
      fillPrice > 0 && { price: fillPrice, color: C.orange },
      track && Number.isFinite(track.peak) && { price: track.peak, color: BULL },
      track && Number.isFinite(track.trough) && { price: track.trough, color: BEAR },
    ].filter(Boolean) as { price: number; color: string }[];
    const handles = lines.map((l) =>
      price.createPriceLine({
        price: l.price, color: l.color, lineWidth: 1, lineStyle: 2,
        axisLabelVisible: false,
      }),
    );

    // The purchase itself — an arrow pinned to the fill bar, so it survives pan
    // and zoom instead of being drawn at a fixed pixel.
    const fillBar = bars.find((b) => b.time >= fillTs - 60_000) ?? bars[0];
    const markers: SeriesMarker<UTCTimestamp>[] = [{
      time: sec(fillBar.time),
      position: side === "buy" ? "belowBar" : "aboveBar",
      color: C.orange,
      shape: side === "buy" ? "arrowUp" : "arrowDown",
      text: `${side === "buy" ? "BOUGHT" : "SOLD"} ${fmtUsd(fillPrice)}`,
    }];

    // Peak / trough as arrow markers pinned to their bar — same treatment as the fill.
    const scan = bars.filter((b) => b.time >= fillTs - 60_000);
    const src = scan.length ? scan : bars;
    if (track && Number.isFinite(track.peak)) {
      const peakBar = src.reduce((a, b) => (b.close > a.close ? b : a), src[0]);
      markers.push({
        time: sec(peakBar.time), position: "aboveBar", color: BULL,
        shape: "arrowDown", text: `PEAK ${fmtUsd(track.peak)}`,
      });
    }
    if (track && Number.isFinite(track.trough)) {
      const troughBar = src.reduce((a, b) => (b.close < a.close ? b : a), src[0]);
      markers.push({
        time: sec(troughBar.time), position: "belowBar", color: BEAR,
        shape: "arrowUp", text: `TROUGH ${fmtUsd(track.trough)}`,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);

    chart.timeScale().fitContent();

    return () => { handles.forEach((h) => price.removePriceLine(h)); };
  }, [bars, fillPrice, fillTs, side, track]);

  // flex:1 + min-height:0 lets the chart consume whatever height the row gives
  // it — without min-height:0 a flex child refuses to shrink and overflows.
  return <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: "100%" }} />;
}
