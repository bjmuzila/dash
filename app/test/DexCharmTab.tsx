"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, statTileStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → DEX / Charm tab.
//
// Theoretical (not live-data) illustration of intraday delta decay for a 0DTE
// options session — the "Charm" effect. For a fixed OTM/ATM/ITM strike, this
// recomputes Black-Scholes call delta, N(d1), at ~27 points across the 9:30am
// - 4:00pm ET session as time-to-expiration collapses toward the close.
//
// This is NOT wired to the live options chain / ThetaTerminal feed — the
// numbers here are a pedagogical model driven by user-adjustable spot,
// strikes, and IV, not measured dealer positioning. A real dealer DEX panel
// (matching the Dealer Gamma tab's approach) would need per-strike OI/volume
// from the same EOD/live sweep that feeds /api/eod-dealer-gamma, run through
// this same delta formula per strike and net by dealer position sign. That is
// future work; this tab is the mechanics demo the trade rests on.
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = "#FFB703";

// ── Black-Scholes call delta ────────────────────────────────────────────────
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

// ── chart ────────────────────────────────────────────────────────────────────
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
  otm, atm, itm, hoverIdx, onHover,
}: {
  otm: number[]; atm: number[]; itm: number[];
  hoverIdx: number | null; onHover: (idx: number | null) => void;
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
              stroke={v === 0 ? HOME_THEME.border : HOME_THEME.border}
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
  const [spot, setSpot] = useState(5500);
  const [otmK, setOtmK] = useState(5520);
  const [atmK, setAtmK] = useState(5500);
  const [itmK, setItmK] = useState(5480);
  const [ivPct, setIvPct] = useState(12);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { otm, atm, itm } = useMemo(() => computeSeries(spot, otmK, atmK, itmK, ivPct), [spot, otmK, atmK, itmK, ivPct]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
        <Field label="Spot (S)" value={spot} onChange={setSpot} />
        <Field label="OTM strike" value={otmK} onChange={setOtmK} />
        <Field label="ATM strike" value={atmK} onChange={setAtmK} />
        <Field label="ITM strike" value={itmK} onChange={setItmK} />
        <Field label="Implied vol (σ, %)" value={ivPct} onChange={setIvPct} step={0.5} />
      </div>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title={<span style={{ fontSize: 17 }}>Theoretical 0DTE call delta decay (Charm effect)</span>}
        subtitle="Black-Scholes N(d1) recomputed across the trading session — not sourced from a live chain"
        style={{ marginTop: 16 }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <Tile label="OTM Δ now" value={otm[otm.length - 1].toFixed(3)} sub={`K=${otmK} · decays toward 0`} tone={HOME_THEME.orange} />
          <Tile label="ATM Δ now" value={atm[atm.length - 1].toFixed(3)} sub={`K=${atmK} · hovers near 0.50, then whips`} tone={HOME_THEME.cyan} />
          <Tile label="ITM Δ now" value={itm[itm.length - 1].toFixed(3)} sub={`K=${itmK} · hardens toward 1`} tone={LIGHT_BLUE} />
        </div>

        <DeltaDecayChart otm={otm} atm={atm} itm={itm} hoverIdx={hoverIdx} onHover={setHoverIdx} />

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
          4:00 PM ET for the OTM/ATM/ITM strikes above.
          <br /><br />
          <b style={{ color: GOLD }}>This is theoretical, not measured.</b>{" "}
          Unlike the Dealer Gamma tab, this panel is not wired to a live options chain or the EOD sweep —
          spot, strikes, and IV are whatever you set above. A real dealer DEX view would run this same
          formula per-strike against live OI/volume the way <code>eod-dte-gamma-recorder.js</code> already
          does for gamma, then net by measured or convention-based position sign.
        </div>
      </Card>
    </>
  );
}
