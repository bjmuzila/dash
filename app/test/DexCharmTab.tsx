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
  error?: string;
};

function useLiveGex() {
  const [data, setData] = useState<LiveGexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/gex", { cache: "no-store" });
      const json = (await res.json()) as LiveGexResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
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

  return { data, loading, err, reload: load };
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

/** Diverging per-strike DEX bars around spot — same visual language as
 * DealerGammaTab's gamma bars, just fed real netDEX instead of netGamma. */
function LiveDexBars({ rows, spot }: { rows: LiveChainRow[]; spot: number }) {
  const windowed = useMemo(() => {
    if (!rows.length || !(spot > 0)) return [];
    return [...rows]
      .filter((r) => Math.abs(r.strike - spot) <= spot * 0.02) // ~±2% around spot
      .sort((a, b) => a.strike - b.strike);
  }, [rows, spot]);

  const max = Math.max(1, ...windowed.map((r) => Math.abs(r.netDEX)));
  if (!windowed.length) {
    return <div style={{ fontSize: 13, color: HOME_THEME.muted, opacity: 0.6 }}>No strikes within ±2% of spot yet.</div>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      {windowed.map((r) => {
        const half = (Math.abs(r.netDEX) / max) * 50;
        const neg = r.netDEX < 0;
        const isSpotStrike = Math.abs(r.strike - spot) < (windowed[1]?.strike ?? spot + 5) - (windowed[0]?.strike ?? spot);
        return (
          <div key={r.strike} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: isSpotStrike ? GOLD : HOME_THEME.muted, opacity: isSpotStrike ? 1 : 0.65, width: 70, textAlign: "right", flex: "none", fontWeight: isSpotStrike ? 800 : 400, fontVariantNumeric: "tabular-nums" }}>
              {r.strike}
            </span>
            <span style={{ flex: 1, height: 16, position: "relative", display: "block" }}>
              <span style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "rgba(255,255,255,0.22)" }} />
              <span
                title={`${r.strike} · ${fmtDex(r.netDEX)} net DEX`}
                style={{
                  position: "absolute", top: 0, height: 16, display: "block",
                  background: neg ? HOME_THEME.red : LIGHT_BLUE,
                  borderRadius: neg ? "4px 0 0 4px" : "0 4px 4px 0",
                  ...(neg ? { right: "50%", width: `${half}%` } : { left: "50%", width: `${half}%` }),
                }}
              />
            </span>
            <span style={{ fontSize: 12.5, width: 84, flex: "none", color: toneOf(r.netDEX), fontVariantNumeric: "tabular-nums" }}>
              {fmtDex(r.netDEX)}
            </span>
          </div>
        );
      })}
    </div>
  );
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
  const { data: live, loading: liveLoading, err: liveErr, reload: reloadLive } = useLiveGex();

  const [spot, setSpot] = useState(5500);
  const [otmK, setOtmK] = useState(5520);
  const [atmK, setAtmK] = useState(5500);
  const [itmK, setItmK] = useState(5480);
  const [ivPct, setIvPct] = useState(12);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [seededFromLive, setSeededFromLive] = useState(false);

  // One-time seed of the theoretical model's inputs from the live spot, so the
  // "what if" chart starts from where the market actually is. After that the
  // user's own edits win — this never overwrites a value they've touched.
  useEffect(() => {
    if (seededFromLive || !live?.spotPrice) return;
    const s = Math.round(live.spotPrice);
    setSpot(s);
    setAtmK(s);
    setOtmK(s + 20);
    setItmK(s - 20);
    setSeededFromLive(true);
  }, [live, seededFromLive]);

  const { otm, atm, itm } = useMemo(() => computeSeries(spot, otmK, atmK, itmK, ivPct), [spot, otmK, atmK, itmK, ivPct]);

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

          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>
            net DEX by strike, ±2% of spot
          </div>
          <LiveDexBars rows={live.chain} spot={live.spotPrice} />

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
        subtitle="Black-Scholes N(d1) recomputed across the trading session — a model, seeded from live spot once, not itself live"
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
          4:00 PM ET for the OTM/ATM/ITM strikes above. Spot and strikes are seeded once from the live snapshot
          above, then fully yours to edit — this chart does not refetch or re-seed after that.
        </div>
      </Card>
    </>
  );
}
