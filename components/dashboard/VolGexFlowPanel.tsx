"use client";

// VolGexFlowPanel — intraday flow of NET VOL GEX for today's session.
//
// Used in two places, same component:
//   • app/home/HomeClient.tsx     → "Vol GEX Flow" tab beside Economic Calendar
//   • app/test/page.tsx           → draggable card on the GEX Levels tab
//
// Data: GET /proxy/gex-vol-flow (server-with-proxy.js), which buckets
// option_strike_gex_history server-side — last reading per (expiry, strike) per
// bucket, summed. Polled; the endpoint caches 20s and the recorder only writes
// ~1/min, so this is cheap.
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

const POLL_MS = 30_000;
const BIN_SEC = 300;

// Sentinel picks. Real picks are ISO expiry strings, which can never collide
// with these because neither parses as a date.
const FRONT = "__front__";
const ALL = "__all__";

export type VolFlowPoint = {
  ts: number;
  spot: number;
  volGex: number;
  oiGex: number;
  combined: number;
  dVol: number | null;
  strikes: number;
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

  // ── Chart ──
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);

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
      leftPriceScale: { visible: false },
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
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(
      points.map((p) => ({ time: Math.floor(p.ts / 1000) as UTCTimestamp, value: p.volGex }))
    );
    try { chartRef.current?.timeScale().fitContent(); } catch { /* not laid out yet */ }
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
      {/* Header — the expiry chooser's menu portals out, but the row still needs
          to sit above the chart canvas while it's open. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap", position: "relative", zIndex: menuOpen ? 30 : 1 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.text }}>
          Net Vol GEX Flow
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
        <span style={{ fontSize: 11, color: C.text, letterSpacing: "0.06em" }}>
          {BIN_SEC / 60}m buckets · today ET
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

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(138px, 1fr))", gap: 6, flexShrink: 0 }}>
        {(cards.length ? cards : Array.from({ length: 6 }, () => null)).map((c, i) => (
          <div
            key={c?.label ?? i}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "rgba(13,17,25,0.35)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", minWidth: 0 }}
          >
            <span style={{ fontSize: 11.5, color: C.text, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, whiteSpace: "nowrap" }}>
              {c?.label ?? "—"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 21, fontWeight: 800, color: c?.color ?? C.text, whiteSpace: "nowrap" }}>
              {c?.value ?? "—"}
            </span>
            <span style={{ fontSize: 11, color: C.text, whiteSpace: "nowrap" }}>{c?.sub ?? ""}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />

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
