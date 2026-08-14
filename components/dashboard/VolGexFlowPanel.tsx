"use client";

// VolGexFlowPanel — intraday flow of NET VOL GEX for today's session.
//
// Used in two places, same component:
//   • app/home/HomeClient.tsx     → "Vol GEX Flow" tab beside Economic Calendar
//   • app/test/page.tsx           → draggable card on the GEX Levels tab
//
// Data: GET /proxy/gex-vol-flow (server-with-proxy.js), which buckets
// option_strike_gex_history server-side — last reading per (expiry, strike) per
// bucket, summed. Polled; the endpoint caches 15s and the recorder writes every
// 30s, so this is cheap.
//
// Why a Baseline series: net vol GEX is a POLARITY measure — the sign is the
// signal (positive = flow adding long gamma / dampening, negative = short
// gamma / amplifying). A baseline series splits the fill at zero natively, so
// the sign is read from color and side without a legend lookup.
//
// Expiry chooser: "Front" tracks the nearest expiry in the newest snapshot
// (re-derived server-side every poll, so it follows the roll on its own).
// "All expiries" sums the whole window. Any specific date pins to that expiry.
// The option list is whatever the endpoint reports as actually having rows
// today, so a pick can never produce an empty chart.
//
// Theme: HOME_THEME tokens only — no ad-hoc hex.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BaselineSeries, ColorType, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

const C = HOME_THEME;

// C.green is the dashboard's light blue — the same token the Levels strip uses
// for a positive Net GEX, so "positive gamma" reads identically across the app.
const POS = C.green;
const NEG = C.red;

// Half the bucket width, so a newly written bucket is on screen within one
// poll rather than up to a full bucket late.
const POLL_MS = 15_000;

// 30s is the floor the endpoint enforces, and it matches the recorder's 30s
// write cadence (gex-history-writer.js). Going 1:1 with the recorder is only
// safe because that recorder writes on a fixed 30s grid slot — the same grid
// the endpoint buckets on — so every bucket holds exactly one row. Under the
// older drifting throttle this 1:1 pairing is what produced the shark tooth:
// buckets that caught two writes threw one away, and the neighbours that
// caught none dropped a point entirely.
const BIN_SEC = 30;

// Buckets are now sub-minute, so `BIN_SEC / 60` would render "0.5m".
const BIN_LABEL = BIN_SEC < 60 ? `${BIN_SEC}s` : `${BIN_SEC / 60}m`;

// Sentinel picks. Real picks are ISO expiry strings, which can never collide
// with these because neither parses as a date.
const FRONT = "__front__";
const ALL = "__all__";

// ── +GEX % view ─────────────────────────────────────────────────────────────
// A full swap, not an overlay: the switch replaces the $ series with the % one
// and re-labels the six stat cards. Two series stacked on one canvas was tried
// first and read as noise — different units, different shapes, neither legible.
//
// Orange above the 50 line, cyan below. Deliberately NOT the theme green/red:
// those two already mean gamma polarity for the dollar series on this same
// canvas, and reusing them here would suggest the two views plot the same thing.
//
// `posPct` rides along on the SAME /proxy/gex-vol-flow response the chart
// already fetches — the endpoint sums the positive and absolute legs over the
// same per-strike rows in the same pass. So the line arrives complete for the
// whole session on first load, is identical on every device, and follows the
// expiry chooser: pick a date and the share is that expiry's chain.
//
// (It was briefly sampled client-side instead. That only recorded from whenever
// the page happened to be opened — open the tab at 2pm and the line started at
// 2pm while the blue series showed the full session beside it.)
const PCT = C.orange;
const PCT_VIEW_KEY = "cbedge.volGexFlow.pctView";

export type VolFlowPoint = {
  ts: number;
  spot: number;
  volGex: number;
  oiGex: number;
  combined: number;
  dVol: number | null;
  strikes: number;
  // Positive share of the bucket's |net GEX|, 0–100 — the "+GEX %" number from
  // the home Levels strip. null on a bucket with no rows.
  posGex?: number;
  absGex?: number;
  posPct?: number | null;
};

type ExpiryInfo = { expiry: string; rows: number; lastTs: number };

type VolFlowResponse = {
  ok?: boolean;
  reason?: string;
  scope?: string;
  session?: string;
  expiry?: string | null;
  binSec?: number;
  expiries?: ExpiryInfo[];
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

// "2026-07-31" → "Jul 31". Parsed as UTC noon so the label can't slip a day in
// a west-of-UTC timezone.
function shortExpiry(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export default function VolGexFlowPanel() {
  const [pick, setPick] = useState<string>(FRONT);
  const [session, setSession] = useState<"rth" | "eth">("rth");
  const [points, setPoints] = useState<VolFlowPoint[]>([]);
  const [expiries, setExpiries] = useState<ExpiryInfo[]>([]);
  const [resolvedExpiry, setResolvedExpiry] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Opt-in, remembered for the browser session. Default off so the tab still
  // opens on the dollar series it has always shown.
  const [showPct, setShowPct] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(PCT_VIEW_KEY) === "1") setShowPct(true); } catch {}
  }, []);
  const togglePct = useCallback(() => {
    setShowPct((v) => {
      try { sessionStorage.setItem(PCT_VIEW_KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  }, []);

  // Two points minimum — one makes a dot, not a line, and the switch would look
  // broken. Also gates the whole control on an older server that predates the
  // endpoint's posPct field, so the tab degrades to its previous behaviour
  // rather than offering a toggle that draws nothing.
  const pctPoints = useMemo(
    () => points.filter((p) => p.posPct != null && Number.isFinite(p.posPct)),
    [points]
  );
  const hasPct = pctPoints.length > 1;
  const pctView = showPct && hasPct;

  const load = useCallback(async () => {
    const qs =
      pick === ALL ? `scope=all` : pick === FRONT ? `scope=front` : `expiry=${encodeURIComponent(pick)}`;
    try {
      const r = await fetch(`/proxy/gex-vol-flow?bin=${BIN_SEC}&session=${session}&${qs}`, { cache: "no-store" });
      const j = (await r.json()) as VolFlowResponse;
      if (j?.ok === false) {
        setErr(j.reason === "no-db" ? "History DB unavailable" : "Feed unavailable");
        setPoints([]);
      } else {
        setPoints(Array.isArray(j?.points) ? j.points : []);
        setExpiries(Array.isArray(j?.expiries) ? j.expiries : []);
        setResolvedExpiry(j?.expiry ?? null);
        setErr(null);
      }
      setUpdatedAt(Date.now());
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [pick, session]);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    setLoading(true);
    tick();
    const id = setInterval(tick, POLL_MS);
    // Refresh immediately when the tab comes back — a backgrounded tab throttles
    // the interval, so returning to it would otherwise show a stale last bucket.
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const expiryOptions = useMemo(() => {
    const opts = [
      { value: FRONT, label: resolvedExpiry ? `Front · ${shortExpiry(resolvedExpiry)}` : "Front" },
      { value: ALL, label: "All expiries" },
    ];
    for (const e of expiries) {
      opts.push({ value: e.expiry, label: `${shortExpiry(e.expiry)} · ${e.rows.toLocaleString()} rows` });
    }
    return opts;
  }, [expiries, resolvedExpiry]);

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
    return {
      last,
      high: { v: vals[hiIdx], at: points[hiIdx].ts },
      low: { v: vals[loIdx], at: points[loIdx].ts },
      flips,
    };
  }, [points]);

  // Same shape, computed on the % series. Kept separate rather than folded into
  // `stats` because the two views cover different bucket sets: a bucket with
  // rows but no gamma at all has a volGex and no posPct.
  const pctStats = useMemo(() => {
    if (pctPoints.length === 0) return null;
    const vals = pctPoints.map((p) => p.posPct as number);
    const last = pctPoints[pctPoints.length - 1];
    const hiIdx = vals.reduce((m, v, i) => (v > vals[m] ? i : m), 0);
    const loIdx = vals.reduce((m, v, i) => (v < vals[m] ? i : m), 0);
    const above = vals.filter((v) => v >= 50).length;
    // 50-crossings, not 0-crossings: on this series the regime change is the
    // chain flipping between net long and net short gamma.
    let flips = 0;
    for (let i = 1; i < vals.length; i++) {
      if ((vals[i - 1] < 50 && vals[i] >= 50) || (vals[i - 1] >= 50 && vals[i] < 50)) flips++;
    }
    const prev = vals.length > 1 ? vals[vals.length - 2] : null;
    return {
      last: { v: vals[vals.length - 1], ts: last.ts, strikes: last.strikes },
      d: prev == null ? null : vals[vals.length - 1] - prev,
      high: { v: vals[hiIdx], at: pctPoints[hiIdx].ts },
      low: { v: vals[loIdx], at: pctPoints[loIdx].ts },
      abovePct: (above / vals.length) * 100,
      flips,
    };
  }, [pctPoints]);

  // ── Chart ──
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  const pctSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  // Read by the % series' autoscale provider, which lightweight-charts calls
  // during its own layout pass — a ref, not state, because the provider is
  // captured once at series creation and would otherwise close over stale data.
  const pctValsRef = useRef<number[]>([]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
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
      // Left scale carries the % series. Declared in the constructor rather than
      // added on demand so switching views only flips `visible` — adding a price
      // scale to a live chart re-lays-out the pane and jumps the series.
      leftPriceScale: { visible: false, borderColor: C.border },
      handleScale: false,
      handleScroll: false,
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => (typeof time === "number" ? etTime(time) : ""),
      },
      localization: {
        priceFormatter: (p: number) => fmtGex(p, 1),
        timeFormatter: (time: unknown) => (typeof time === "number" ? etTime(time) : ""),
      },
    });

    seriesRef.current = chart.addSeries(BaselineSeries, {
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

    // +GEX % view — a second Baseline, split at 50 instead of 0, on the LEFT
    // scale. Two scales rather than one shared: each carries exactly one series,
    // so each keeps its own price formatter ($ vs %) with no fighting over which
    // series formats the axis. Only one is ever visible.
    pctSeriesRef.current = chart.addSeries(BaselineSeries, {
      priceScaleId: "left",
      baseValue: { type: "price", price: 50 },
      topLineColor: PCT,
      topFillColor1: "rgba(251,133,1,0.34)",
      topFillColor2: "rgba(251,133,1,0.02)",
      bottomLineColor: C.cyan,
      bottomFillColor1: "rgba(33,158,188,0.02)",
      bottomFillColor2: "rgba(33,158,188,0.34)",
      lineWidth: 2,
      priceLineVisible: false,
      visible: false,
      priceFormat: { type: "custom", minMove: 0.1, formatter: (p: number) => `${p.toFixed(0)}%` },
      // Padded around the data but ALWAYS containing 50, clamped to 0–100. Pure
      // data-fit would put the midline wherever it landed and make a 58–64 day
      // look like a regime war; a hard 0–100 would flatten that same day into a
      // dead straight line. This keeps the 50 crossing visible and the shape
      // readable at the same time.
      autoscaleInfoProvider: () => {
        const vals = pctValsRef.current;
        if (!vals.length) return { priceRange: { minValue: 0, maxValue: 100 } };
        const lo = Math.max(0, Math.min(50, ...vals) - 5);
        const hi = Math.min(100, Math.max(50, ...vals) + 5);
        return { priceRange: { minValue: lo, maxValue: hi } };
      },
    });
    chart.priceScale("left").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.14 } });
    chartRef.current = chart;

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

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      pctSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(
      points.map((p) => ({ time: Math.floor(p.ts / 1000) as UTCTimestamp, value: p.volGex }))
    );
    try { chartRef.current?.timeScale().fitContent(); } catch { /* not laid out yet */ }
  }, [points]);

  useEffect(() => {
    const s = pctSeriesRef.current;
    if (!s) return;
    pctValsRef.current = pctPoints.map((p) => p.posPct as number);
    s.setData(
      pctPoints.map((p) => ({
        time: Math.floor(p.ts / 1000) as UTCTimestamp,
        value: p.posPct as number,
      }))
    );
  }, [pctPoints]);

  // View swap. Split from the chart-creation effect so switching never tears
  // down and rebuilds the canvas — only visibility and which scale is showing.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !seriesRef.current || !pctSeriesRef.current) return;
    seriesRef.current.applyOptions({ visible: !pctView });
    pctSeriesRef.current.applyOptions({ visible: pctView });
    chart.applyOptions({
      rightPriceScale: { visible: !pctView, borderColor: C.border },
      leftPriceScale: { visible: pctView, borderColor: C.border },
    });
    try { chart.timeScale().fitContent(); } catch { /* not laid out yet */ }
  }, [pctView]);

  // ── Cards ──
  // The six tiles re-label with the view. Same grid, same order of meaning
  // (now / change / high / low / regime / context) so the eye doesn't have to
  // re-learn the block when you flip the switch.
  const cards = useMemo(() => {
    if (pctView) {
      if (!pctStats) return [];
      const s = pctStats;
      const ink = (v: number) => (v >= 50 ? PCT : C.cyan);
      return [
        { label: "+GEX %", value: `${s.last.v.toFixed(0)}%`, sub: etTime(Math.floor(s.last.ts / 1000)), color: ink(s.last.v) },
        { label: "Δ Last Bucket", value: s.d == null ? "—" : `${s.d > 0 ? "+" : "−"}${Math.abs(s.d).toFixed(1)}pt`, sub: BIN_LABEL, color: (s.d ?? 0) >= 0 ? PCT : C.cyan },
        { label: "Session High", value: `${s.high.v.toFixed(0)}%`, sub: etTime(Math.floor(s.high.at / 1000)), color: PCT },
        { label: "Session Low", value: `${s.low.v.toFixed(0)}%`, sub: etTime(Math.floor(s.low.at / 1000)), color: C.cyan },
        { label: "Time > 50%", value: `${s.abovePct.toFixed(0)}%`, sub: s.flips === 0 ? "one regime" : `${s.flips} regime changes`, color: s.abovePct >= 50 ? PCT : C.cyan },
        { label: "Regime", value: s.last.v >= 50 ? "LONG γ" : "SHORT γ", sub: `${s.last.strikes} strikes`, color: ink(s.last.v) },
      ];
    }
    if (!stats) return [];
    const last = stats.last;
    return [
      { label: "Net Vol GEX", value: fmtGex(last.volGex), sub: etTime(Math.floor(last.ts / 1000)), color: last.volGex >= 0 ? POS : NEG },
      { label: "Δ Last Bucket", value: last.dVol == null ? "—" : `${last.dVol > 0 ? "+" : ""}${fmtGex(last.dVol)}`, sub: BIN_LABEL, color: (last.dVol ?? 0) >= 0 ? POS : NEG },
      { label: "Session High", value: fmtGex(stats.high.v), sub: etTime(Math.floor(stats.high.at / 1000)), color: POS },
      { label: "Session Low", value: fmtGex(stats.low.v), sub: etTime(Math.floor(stats.low.at / 1000)), color: stats.low.v < 0 ? NEG : C.text },
      { label: "Sign Flips", value: String(stats.flips), sub: stats.flips === 0 ? "one regime" : "regime changes", color: stats.flips > 0 ? C.orange : C.cyan },
      { label: "Spot", value: last.spot ? last.spot.toFixed(2) : "—", sub: `${last.strikes} strikes`, color: C.cyan },
    ];
  }, [stats, pctStats, pctView]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 8, padding: 14, overflow: "auto" }}>
      {/* Header — the expiry chooser's menu portals out, but the row still needs
          to sit above the chart canvas while it's open. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap", position: "relative", zIndex: menuOpen ? 30 : 1 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.text }}>
          {pctView ? "+GEX % of Chain" : "Net Vol GEX Flow"}
        </span>
        <ThemedSelect
          value={pick}
          options={expiryOptions}
          onChange={setPick}
          onOpenChange={setMenuOpen}
          width={190}
          ariaLabel="Expiration"
        />
        {/* Session switch. RTH is the default because the overnight stretch has
            no new prints — values persist until the chain resets, which draws a
            long flat line and a phantom step that read as signal but aren't. */}
        <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 7, overflow: "hidden" }}>
          {([
            { id: "rth", label: "RTH", title: "Regular hours — 09:30–16:00 ET" },
            { id: "eth", label: "ETH", title: "Extended — the whole ET day, including the overnight tail" },
          ] as const).map((s) => {
            const on = session === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSession(s.id)}
                title={s.title}
                aria-pressed={on}
                style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
                  padding: "3px 10px", cursor: "pointer", border: "none",
                  // Off state stays full-strength white: the cyan tint + cyan
                  // ink on the active button carries the state, so dimming the
                  // inactive one is redundant and just costs legibility.
                  background: on ? "rgba(33,158,188,0.18)" : "transparent",
                  color: on ? C.cyan : C.text,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {/* View switch — same segmented shape as RTH/ETH so the header reads as
            one control row, tinted orange in the % view to match the series.
            Hidden, not shown dead, when the response carries no posPct — an
            older server, or a window with no rows. */}
        {hasPct && (
          <div style={{ display: "flex", border: `1px solid ${pctView ? "rgba(251,133,1,0.40)" : C.border}`, borderRadius: 7, overflow: "hidden" }}>
            {([
              { on: false, label: "$ GEX", title: "Net vol GEX in dollars — the signed flow series" },
              { on: true, label: "+GEX %", title: "Share of the selected expiry's |net GEX| (OI+Vol) that is positive — the same number as the home Levels strip's +GEX % tile. Above 50% = long-gamma chain." },
            ] as const).map((o) => {
              const active = showPct === o.on;
              return (
                <button
                  key={o.label}
                  onClick={() => { if (!active) togglePct(); }}
                  title={o.title}
                  aria-pressed={active}
                  style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
                    padding: "3px 10px", cursor: "pointer", border: "none",
                    background: active && o.on ? "rgba(251,133,1,0.18)" : active ? "rgba(255,255,255,0.06)" : "transparent",
                    color: active && o.on ? PCT : C.text,
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
        <span style={{ fontSize: 11, color: C.text, letterSpacing: "0.06em" }}>
          {BIN_LABEL} buckets · today ET
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {updatedAt && (
            <span style={{ fontSize: 11, color: C.text, fontFamily: "var(--font-mono)" }}>
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

      {/* Cards — pinned to a 3×2 grid. auto-fit used to reflow from one row to
          two to three as the window narrowed, and every row it added came
          straight out of the chart's height. A fixed column count keeps this
          block the same height at every width, so the chart never moves. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5, flexShrink: 0 }}>
        {(cards.length ? cards : Array.from({ length: 6 }, () => null)).map((c, i) => (
          <div
            key={c?.label ?? i}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, background: "rgba(13,17,25,0.35)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "4px 8px", minWidth: 0 }}
          >
            <span style={{ fontSize: 9.5, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
              {c?.label ?? "—"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, lineHeight: 1.25, fontWeight: 800, color: c?.color ?? C.text, whiteSpace: "nowrap" }}>
              {c?.value ?? "—"}
            </span>
            <span style={{ fontSize: 9, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{c?.sub ?? ""}</span>
          </div>
        ))}
      </div>

      {/* Chart — minHeight floors the canvas so a short window scrolls the panel
          rather than squeezing the chart down to a sliver. */}
      <div style={{ flex: 1, minHeight: 200, position: "relative" }}>
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />

        {/* Corner labels instead of a legend — with one series on screen the
            question isn't "which line is which", it's "which side of the 50 line
            am I on". pointerEvents:none so they never eat a crosshair hover. */}
        {pctView && (
          <>
            <span style={{ position: "absolute", top: 6, left: 10, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", color: "rgba(251,133,1,0.85)", pointerEvents: "none" }}>
              LONG GAMMA
            </span>
            <span style={{ position: "absolute", bottom: 24, left: 10, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", color: "rgba(33,158,188,0.85)", pointerEvents: "none" }}>
              SHORT GAMMA
            </span>
          </>
        )}

        {(loading || err || (!points.length && !loading)) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,6,10,0.72)", borderRadius: 10, textAlign: "center", padding: 16 }}>
            <span style={{ fontSize: 12, color: err ? C.red : C.cyan, letterSpacing: "0.06em", fontWeight: 700 }}>
              {err
                ? err
                : loading
                  ? "Loading net vol GEX history…"
                  : session === "rth"
                    ? "No snapshots in today's RTH window — try ETH"
                    : "No snapshots recorded yet today"}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
