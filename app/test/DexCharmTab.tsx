"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, statTileStyle, homeInputStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → DEX / Charm tab.
//
// Two sections:
//
//   1. LIVE — real dealer DEX read straight from /api/gex, the same endpoint
//      GEX Map's exposure numbers come from. netDEX per strike and the
//      totalDeltaOiVol aggregate are computed server-side by
//      server-v2/computation/gex-calculator.js:
//        netDEX = callDelta × callOI × spot × 100 − putDelta × putOI × spot × 100
//      Real chain, real OI, real Black-Scholes greeks off the live feed — not a
//      model. This is the actual measured book (0DTE front expiry, whatever
//      /proxy/gex is currently pinned to).
//
//   2. THEORETICAL MODEL — the original Charm-decay illustration: Black-Scholes
//      delta recomputed across a synthetic 9:30-4:00 session for user-chosen
//      spot/strikes/IV. Kept because it's the clearest way to SEE why the live
//      numbers above move the way they do intraday (charm), even though it
//      isn't itself measuring anything.
//
// Keeping both, clearly labeled, rather than replacing one with the other —
// same "what is measured vs assumed" discipline DealerGammaTab uses.
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = "#FFB703";

// ── Black-Scholes call delta (theoretical section) ─────────────────────────
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
/** t: fraction of trading day remaining (1 at open, 0 at close). r: annual rate. */
function callDelta(S: number, K: number, sigma: number, t: number, r: number): number {
  const T = Math.max(t, 0.0007) * (1 / 252); // year-fraction of a session; floor avoids t=0 blow-up
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  return normCDF(d1);
}

const N_POINTS = 27;
const TIMES = Array.from({ length: N_POINTS }, (_, i) => i / (N_POINTS - 1));

function fmtTimeLabel(frac: number): string {
  const startMin = 9 * 60 + 30;
  const totalMin = 6.5 * 60;
  const m = startMin + frac * totalMin;
  const hh = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  const ampm = hh >= 12 ? "PM" : "AM";
  let hh12 = hh % 12;
  if (hh12 === 0) hh12 = 12;
  return `${hh12}:${mm.toString().padStart(2, "0")} ${ampm}`;
}

function computeSeries(S: number, Kotm: number, Katm: number, Kitm: number, sigmaPct: number) {
  const sigma = sigmaPct / 100;
  const r = 0.045;
  const otm: number[] = [], atm: number[] = [], itm: number[] = [];
  for (const frac of TIMES) {
    const tRemaining = 1 - frac;
    otm.push(callDelta(S, Kotm, sigma, tRemaining, r));
    atm.push(callDelta(S, Katm, sigma, tRemaining, r));
    itm.push(callDelta(S, Kitm, sigma, tRemaining, r));
  }
  return { otm, atm, itm };
}

/** Fraction of the 9:30–4:00 ET session elapsed right now, clamped to [0,1].
 * Reads the wall clock in America/New_York regardless of the viewer's own
 * timezone, so "now" always lines up with the session the chart is drawn for. */
function nowSessionFrac(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const minutesNow = get("hour") * 60 + get("minute") + get("second") / 60;
  const openMin = 9 * 60 + 30;
  const sessionMin = 6.5 * 60;
  return Math.max(0, Math.min(1, (minutesNow - openMin) / sessionMin));
}

/** Nearest sample index in TIMES for a given session fraction. */
function nearestTimeIdx(frac: number): number {
  return Math.max(0, Math.min(N_POINTS - 1, Math.round(frac * (N_POINTS - 1))));
}

/** Same as nowSessionFrac but for an arbitrary Date, unclamped — negative
 * before the open, >1 after the close, so callers can detect a day rollover. */
function sessionFracForDate(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const minutesNow = get("hour") * 60 + get("minute") + get("second") / 60;
  const openMin = 9 * 60 + 30;
  const sessionMin = 6.5 * 60;
  return (minutesNow - openMin) / sessionMin;
}

// ── live DEX (measured section) ─────────────────────────────────────────────
type LiveChainRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callDelta: number;
  putDelta: number;
  netDEX: number;
  volNetDEX?: number;
};

type LiveTotals = {
  totalDeltaCall?: number;
  totalDeltaPut?: number;
  totalDeltaOiVol?: number;
  totalDeltaVol?: number;
} | null;

type LiveGexResponse = {
  chain: LiveChainRow[];
  spotPrice: number;
  expiration: string | null;
  totals: LiveTotals;
  updatedAt: string | null;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  error?: string;
};

/** One spot-price sample, at the session fraction it was observed. */
type SpotSample = { frac: number; spot: number };

const MAX_SPOT_HISTORY = 900; // ~7.5 hours at one sample/30s — comfortably covers a session

function useLiveGex() {
  const [data, setData] = useState<LiveGexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Spot-over-time history, built client-side from each poll — there is no
  // server-side intraday time series behind this endpoint, only the current
  // snapshot. So this line only covers however long THIS TAB has been open;
  // reloading the page starts it over. Reset automatically on a day rollover
  // (session fraction jumping backward) so it never draws across two days.
  const [history, setHistory] = useState<SpotSample[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/gex", { cache: "no-store" });
      const json = (await res.json()) as LiveGexResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      if (json.spotPrice > 0) {
        const frac = sessionFracForDate(new Date());
        setHistory((prev) => {
          const rolledOver = prev.length > 0 && frac < prev[prev.length - 1].frac - 0.5;
          const base = rolledOver ? [] : prev;
          const next = [...base, { frac, spot: json.spotPrice }];
          return next.length > MAX_SPOT_HISTORY ? next.slice(next.length - MAX_SPOT_HISTORY) : next;
        });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000); // 0DTE book moves fast; refresh every 30s
    return () => clearInterval(id);
  }, [load]);

  return { data, loading, err, reload: load, history };
}

function fmtDex(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
const toneOf = (v: number) => (v < 0 ? HOME_THEME.red : LIGHT_BLUE);

// ── styles ───────────────────────────────────────────────────────────────────
const fieldLabel: CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em",
  color: HOME_THEME.muted, opacity: 0.55, fontWeight: 800, marginBottom: 4,
};
const numInput: CSSProperties = { ...homeInputStyle, width: 100, fontVariantNumeric: "tabular-nums" };

function Field({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={fieldLabel}>{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={numInput}
      />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div style={{ ...statTileStyle, padding: "14px 18px", minWidth: 172, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4, color: tone ?? HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.55, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ── live SPX session chart (spot price over time) ───────────────────────────
function SpxSessionChart({
  history, callWall, putWall, gexFlip,
}: {
  history: SpotSample[]; callWall: number | null; putWall: number | null; gexFlip: number | null;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pts = useMemo(() => history.filter((s) => s.frac >= -0.02 && s.frac <= 1.02), [history]);

  if (pts.length < 2) {
    return (
      <div style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.6, padding: "24px 0" }}>
        Building today's spot line from live polls — check back in a minute or two. This only covers time since
        this tab has been open; there's no server-side intraday history behind this endpoint.
      </div>
    );
  }

  const prices = pts.map((p) => p.spot);
  const refLevels = [callWall, putWall, gexFlip].filter((v): v is number => v != null && v > 0);
  const yMin = Math.min(...prices, ...refLevels) - 2;
  const yMax = Math.max(...prices, ...refLevels) + 2;
  const ySpan = Math.max(1, yMax - yMin);
  const yS = (v: number) => MARGIN.top + (1 - (v - yMin) / ySpan) * PLOT_H;
  const xS = (f: number) => MARGIN.left + Math.max(0, Math.min(1, f)) * PLOT_W;

  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.frac).toFixed(2)} ${yS(p.spot).toFixed(2)}`).join(" ");

  const xTicks = [
    { f: 0, label: "9:30 AM", anchor: "start" as const },
    { f: 1.5 / 6.5, label: "11:00 AM", anchor: "middle" as const },
    { f: 3 / 6.5, label: "12:30 PM", anchor: "middle" as const },
    { f: 4.5 / 6.5, label: "2:00 PM", anchor: "middle" as const },
    { f: 1, label: "4:00 PM", anchor: "end" as const },
  ];

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (mx - MARGIN.left) / PLOT_W;
    // Nearest actual sample to the cursor (samples aren't evenly spaced).
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.frac - frac);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHoverIdx(best);
  };

  const hoverPt = hoverIdx != null ? pts[hoverIdx] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
        {[yMin, (yMin + yMax) / 2, yMax].map((v, i) => (
          <g key={i}>
            <line x1={MARGIN.left} x2={W - MARGIN.right} y1={yS(v)} y2={yS(v)} stroke={HOME_THEME.border} strokeOpacity={0.4} />
            <text x={MARGIN.left - 8} y={yS(v) + 4} textAnchor="end" fontSize={11} fill={HOME_THEME.muted} opacity={0.6}>
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t.label} x={xS(t.f)} y={H - MARGIN.bottom + 20} textAnchor={t.anchor} fontSize={11} fill={HOME_THEME.muted} opacity={0.6}>
            {t.label}
          </text>
        ))}

        {callWall != null && callWall > 0 && (
          <>
            <line x1={MARGIN.left} x2={W - MARGIN.right} y1={yS(callWall)} y2={yS(callWall)} stroke={HOME_THEME.orange} strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.8} />
            <text x={W - MARGIN.right} y={yS(callWall) - 4} textAnchor="end" fontSize={11} fontWeight={800} fill={HOME_THEME.orange}>Call wall {callWall}</text>
          </>
        )}
        {putWall != null && putWall > 0 && (
          <>
            <line x1={MARGIN.left} x2={W - MARGIN.right} y1={yS(putWall)} y2={yS(putWall)} stroke={HOME_THEME.red} strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.8} />
            <text x={W - MARGIN.right} y={yS(putWall) - 4} textAnchor="end" fontSize={11} fontWeight={800} fill={HOME_THEME.red}>Put wall {putWall}</text>
          </>
        )}
        {gexFlip != null && gexFlip > 0 && (
          <>
            <line x1={MARGIN.left} x2={W - MARGIN.right} y1={yS(gexFlip)} y2={yS(gexFlip)} stroke={LIGHT_BLUE} strokeWidth={1.5} strokeDasharray="2 4" strokeOpacity={0.7} />
            <text x={MARGIN.left} y={yS(gexFlip) - 4} textAnchor="start" fontSize={11} fontWeight={800} fill={LIGHT_BLUE}>Gamma flip {gexFlip.toFixed(0)}</text>
          </>
        )}

        <path d={path} fill="none" stroke={HOME_THEME.text} strokeWidth={2} />

        {hoverPt && (
          <>
            <line x1={xS(hoverPt.frac)} x2={xS(hoverPt.frac)} y1={MARGIN.top} y2={H - MARGIN.bottom} stroke={HOME_THEME.muted} strokeOpacity={0.4} strokeDasharray="3 3" />
            <circle cx={xS(hoverPt.frac)} cy={yS(hoverPt.spot)} r={4} fill={HOME_THEME.text} stroke={HOME_THEME.bg} strokeWidth={2} />
          </>
        )}

        <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_W} height={PLOT_H} fill="transparent" style={{ cursor: "crosshair" }} onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)} />
      </svg>

      {hoverPt && (
        <div
          style={{
            position: "absolute",
            left: `${(xS(hoverPt.frac) / W) * 100}%`,
            top: 6,
            transform: hoverPt.frac > 0.7 ? "translateX(-100%)" : "translateX(8px)",
            background: HOME_THEME.panelBgStrong,
            border: `1px solid ${HOME_THEME.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            color: HOME_THEME.text,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: HOME_THEME.muted, opacity: 0.6, fontSize: 11, marginBottom: 4 }}>{fmtTimeLabel(Math.max(0, Math.min(1, hoverPt.frac)))}</div>
          <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{hoverPt.spot.toFixed(2)}</div>
        </div>
      )}
    </div>
  );
}

// ── theoretical chart ────────────────────────────────────────────────────────
const W = 860, H = 340;
const MARGIN = { top: 16, right: 20, bottom: 36, left: 40 };
const PLOT_W = W - MARGIN.left - MARGIN.right;
const PLOT_H = H - MARGIN.top - MARGIN.bottom;
const xScale = (f: number) => MARGIN.left + f * PLOT_W;
const yScale = (v: number) => MARGIN.top + (1 - v) * PLOT_H;

function pathFor(series: number[]): string {
  return series.map((v, i) => `${i === 0 ? "M" : "L"} ${xScale(TIMES[i]).toFixed(2)} ${yScale(v).toFixed(2)}`).join(" ");
}

function DeltaDecayChart({
  otm, atm, itm, hoverIdx, onHover, nowIdx,
}: {
  otm: number[]; atm: number[]; itm: number[];
  hoverIdx: number | null; onHover: (idx: number | null) => void;
  nowIdx: number | null;
}) {
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
  const xTicks = [
    { f: 0, label: "9:30 AM", anchor: "start" as const },
    { f: 1.5 / 6.5, label: "11:00 AM", anchor: "middle" as const },
    { f: 3 / 6.5, label: "12:30 PM", anchor: "middle" as const },
    { f: 4.5 / 6.5, label: "2:00 PM", anchor: "middle" as const },
    { f: 1, label: "4:00 PM", anchor: "end" as const },
  ];

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let frac = (mx - MARGIN.left) / PLOT_W;
    frac = Math.max(0, Math.min(1, frac));
    onHover(Math.max(0, Math.min(N_POINTS - 1, Math.round(frac * (N_POINTS - 1)))));
  };

  const hx = hoverIdx != null ? xScale(TIMES[hoverIdx]) : null;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left} x2={W - MARGIN.right} y1={yScale(v)} y2={yScale(v)}
              stroke={HOME_THEME.border}
              strokeOpacity={v === 0 ? 0.9 : 0.4}
            />
            <text x={MARGIN.left - 8} y={yScale(v) + 4} textAnchor="end" fontSize={11} fill={HOME_THEME.muted} opacity={0.6}>
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t.label} x={xScale(t.f)} y={H - MARGIN.bottom + 20} textAnchor={t.anchor} fontSize={11} fill={HOME_THEME.muted} opacity={0.6}>
            {t.label}
          </text>
        ))}

        <path d={pathFor(otm)} fill="none" stroke={HOME_THEME.orange} strokeWidth={2} />
        <path d={pathFor(atm)} fill="none" stroke={HOME_THEME.cyan} strokeWidth={2} strokeDasharray="5 4" />
        <path d={pathFor(itm)} fill="none" stroke={LIGHT_BLUE} strokeWidth={2} />

        {nowIdx != null && (
          <>
            <line
              x1={xScale(TIMES[nowIdx])} x2={xScale(TIMES[nowIdx])}
              y1={MARGIN.top} y2={H - MARGIN.bottom}
              stroke={GOLD} strokeWidth={1.5} strokeOpacity={0.85}
            />
            <text x={xScale(TIMES[nowIdx])} y={MARGIN.top - 4} textAnchor="middle" fontSize={10} fontWeight={800} fill={GOLD} letterSpacing="0.08em">
              NOW
            </text>
          </>
        )}

        {hx != null && hoverIdx != null && (
          <>
            <line x1={hx} x2={hx} y1={MARGIN.top} y2={H - MARGIN.bottom} stroke={HOME_THEME.muted} strokeOpacity={0.4} strokeDasharray="3 3" />
            <circle cx={hx} cy={yScale(otm[hoverIdx])} r={4} fill={HOME_THEME.orange} stroke={HOME_THEME.bg} strokeWidth={2} />
            <circle cx={hx} cy={yScale(atm[hoverIdx])} r={4} fill={HOME_THEME.cyan} stroke={HOME_THEME.bg} strokeWidth={2} />
            <circle cx={hx} cy={yScale(itm[hoverIdx])} r={4} fill={LIGHT_BLUE} stroke={HOME_THEME.bg} strokeWidth={2} />
          </>
        )}

        <rect
          x={MARGIN.left} y={MARGIN.top} width={PLOT_W} height={PLOT_H}
          fill="transparent" style={{ cursor: "crosshair" }}
          onMouseMove={handleMove}
          onMouseLeave={() => onHover(null)}
        />
      </svg>

      {hoverIdx != null && (
        <div
          style={{
            position: "absolute",
            left: `${(xScale(TIMES[hoverIdx]) / W) * 100}%`,
            top: 6,
            transform: hoverIdx > N_POINTS * 0.7 ? "translateX(-100%)" : "translateX(8px)",
            background: HOME_THEME.panelBgStrong,
            border: `1px solid ${HOME_THEME.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            color: HOME_THEME.text,
            pointerEvents: "none",
            minWidth: 150,
          }}
        >
          <div style={{ color: HOME_THEME.muted, opacity: 0.6, fontSize: 11, marginBottom: 4 }}>{fmtTimeLabel(TIMES[hoverIdx])}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: HOME_THEME.orange }}>OTM</span><span>{otm[hoverIdx].toFixed(3)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
            <span style={{ color: HOME_THEME.cyan }}>ATM</span><span>{atm[hoverIdx].toFixed(3)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
            <span style={{ color: LIGHT_BLUE }}>ITM</span><span>{itm[hoverIdx].toFixed(3)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── tab ──────────────────────────────────────────────────────────────────────
export default function DexCharmTab() {
  const { data: live, loading: liveLoading, err: liveErr, reload: reloadLive, history: spotHistory } = useLiveGex();

  const [spot, setSpot] = useState(5500);
  const [otmK, setOtmK] = useState(5520);
  const [atmK, setAtmK] = useState(5500);
  const [itmK, setItmK] = useState(5480);
  const [ivPct, setIvPct] = useState(12);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Live spot tracking: ON by default, so the model always reflects where SPX
  // actually is right now — not a one-time seed. ATM/OTM/ITM strikes ride
  // along with spot (fixed ±20 offsets) so the curve keeps its OTM/ATM/ITM
  // shape as spot moves. Any manual edit to spot or a strike snaps this off,
  // so the user's own "what if" values are never silently overwritten.
  const [liveSpotSync, setLiveSpotSync] = useState(true);

  useEffect(() => {
    if (!liveSpotSync || !live?.spotPrice) return;
    const s = Math.round(live.spotPrice);
    setSpot(s);
    setAtmK(s);
    setOtmK(s + 20);
    setItmK(s - 20);
  }, [live, liveSpotSync]);

  const manualField = (setter: (v: number) => void) => (v: number) => {
    setLiveSpotSync(false);
    setter(v);
  };

  const { otm, atm, itm } = useMemo(() => computeSeries(spot, otmK, atmK, itmK, ivPct), [spot, otmK, atmK, itmK, ivPct]);

  // "Now" marker: recompute the session-elapsed fraction every 30s so the
  // gold line on the chart (and the delta tiles) track the actual ET clock,
  // not just the moment the tab mounted.
  const [nowFrac, setNowFrac] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowFrac(nowSessionFrac());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const nowIdx = nowFrac != null ? nearestTimeIdx(nowFrac) : null;
  const tileIdx = nowIdx ?? otm.length - 1;

  const totals = live?.totals;
  const netDex = totals?.totalDeltaOiVol ?? (totals ? (totals.totalDeltaCall ?? 0) + (totals.totalDeltaPut ?? 0) : null);

  return (
    <>
      {/* ── LIVE ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={reloadLive} style={homeButtonStyle}>Refresh</button>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>
          {liveLoading && !live
            ? "Loading live chain…"
            : live
              ? `${live.expiration ?? "front expiry"} · spot ${live.spotPrice ? live.spotPrice.toFixed(2) : "—"}${live.updatedAt ? ` · updated ${new Date(live.updatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET` : ""}`
              : "No live data yet"}
        </div>
      </div>

      {liveErr && (
        <Card variant="budget" accent={HOME_THEME.red} title="Live DEX">
          <div style={{ fontSize: 14, color: HOME_THEME.red }}>Error: {liveErr}</div>
        </Card>
      )}

      {!liveErr && live && live.chain?.length > 0 && (
        <Card
          variant="budget"
          accent={LIGHT_BLUE}
          title={<span style={{ fontSize: 17 }}>Live dealer DEX (measured)</span>}
          subtitle="netDEX = callDelta × callOI × spot × 100 − putDelta × putOI × spot × 100, per strike, from the live chain — same pipeline GEX Map reads"
          style={{ marginTop: 16 }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
            <Tile
              label="net dealer DEX"
              value={netDex != null ? fmtDex(netDex) : "—"}
              sub="OI + Vol, all strikes"
              tone={netDex != null ? toneOf(netDex) : undefined}
            />
            <Tile
              label="call-side DEX"
              value={totals?.totalDeltaCall != null ? fmtDex(totals.totalDeltaCall) : "—"}
              sub="dealer long calls convention"
              tone={LIGHT_BLUE}
            />
            <Tile
              label="put-side DEX"
              value={totals?.totalDeltaPut != null ? fmtDex(totals.totalDeltaPut) : "—"}
              sub="dealer short puts convention"
              tone={HOME_THEME.red}
            />
            <Tile
              label="spot"
              value={live.spotPrice ? live.spotPrice.toFixed(2) : "—"}
              sub={live.expiration ?? "front expiry"}
            />
          </div>

          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 4 }}>
            SPX today — spot vs. call wall / put wall / gamma flip
          </div>
          <SpxSessionChart history={spotHistory} callWall={live.callWall} putWall={live.putWall} gexFlip={live.gexFlip} />

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${HOME_THEME.border}`, fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.65, opacity: 0.88 }}>
            <b style={{ color: GOLD }}>What is measured vs. assumed.</b>{" "}
            OI, strikes, and Black-Scholes greeks are read live off the chain — nothing here is a model input. The
            call+/put− position sign is the ordinary OI convention (dealer long calls, short puts), the same
            convention GEX Map and the un-bucketed rows of Dealer Gamma use — not measured taker flow.
          </div>
        </Card>
      )}

      {!liveErr && !liveLoading && (!live || !live.chain?.length) && (
        <Card variant="budget" accent={HOME_THEME.orange} title="No live chain yet">
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.8 }}>
            /api/gex returned no chain rows. The feed may be between snapshots — try Refresh.
          </div>
        </Card>
      )}

      {/* ── THEORETICAL MODEL ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap", marginTop: 28 }}>
        <Field label="Spot (S)" value={spot} onChange={manualField(setSpot)} />
        <Field label="OTM strike" value={otmK} onChange={manualField(setOtmK)} />
        <Field label="ATM strike" value={atmK} onChange={manualField(setAtmK)} />
        <Field label="ITM strike" value={itmK} onChange={manualField(setItmK)} />
        <Field label="Implied vol (σ, %)" value={ivPct} onChange={setIvPct} step={0.5} />
        <button
          onClick={() => setLiveSpotSync((v) => !v)}
          style={{ ...homeButtonStyle, ...(liveSpotSync ? {} : { color: HOME_THEME.muted, border: `1px solid ${HOME_THEME.border}`, background: "rgba(255,255,255,0.04)" }) }}
        >
          {liveSpotSync ? "● Live spot: ON" : "○ Live spot: OFF"}
        </button>
      </div>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title={<span style={{ fontSize: 17 }}>Theoretical 0DTE call delta decay (Charm effect)</span>}
        subtitle={
          liveSpotSync
            ? `Black-Scholes N(d1) recomputed across the trading session — spot and ATM/OTM/ITM strikes track live SPX (currently ${spot})`
            : "Black-Scholes N(d1) recomputed across the trading session — live spot sync is off, values are yours"
        }
        style={{ marginTop: 16 }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <Tile label="OTM Δ now" value={otm[tileIdx].toFixed(3)} sub={`K=${otmK} · decays toward 0`} tone={HOME_THEME.orange} />
          <Tile label="ATM Δ now" value={atm[tileIdx].toFixed(3)} sub={`K=${atmK} · hovers near 0.50, then whips`} tone={HOME_THEME.cyan} />
          <Tile label="ITM Δ now" value={itm[tileIdx].toFixed(3)} sub={`K=${itmK} · hardens toward 1`} tone={LIGHT_BLUE} />
        </div>

        <DeltaDecayChart otm={otm} atm={atm} itm={itm} hoverIdx={hoverIdx} onHover={setHoverIdx} nowIdx={nowIdx} />

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, fontSize: 12.5, color: HOME_THEME.muted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: HOME_THEME.orange, display: "inline-block" }} /> OTM call delta
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 14, height: 0, borderTop: `3px dashed ${HOME_THEME.cyan}`, display: "inline-block" }} /> ATM call delta
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: LIGHT_BLUE, display: "inline-block" }} /> ITM call delta
          </span>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${HOME_THEME.border}`, fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.65, opacity: 0.88 }}>
          <b style={{ color: GOLD }}>Model.</b>{" "}
          Δ_call = N(d₁), with d₁ = [ln(S/K) + (r + σ²/2)t] / (σ√t), r = 4.5%, t = remaining fraction of
          the trading session converted to a year-fraction (÷252). Recomputed at 27 points from 9:30 AM to
          4:00 PM ET for the OTM/ATM/ITM strikes above. With Live spot ON, spot and the ATM/OTM/ITM strikes
          (spot ± 20) update on every refresh of the live chain above (every 30s) — the curve itself is still
          a model, not a measurement, but it's always drawn around where SPX actually is. Edit any field to
          switch to a fixed "what if" scenario; the gold NOW line marks the current point in the session
          regardless.
        </div>
      </Card>
    </>
  );
}
