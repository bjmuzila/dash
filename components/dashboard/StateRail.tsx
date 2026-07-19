"use client";

// StateRail — the 4-row dealer-state rail for the Greeks home tab (treatment A:
// segmented power bars). Four rows, each a bipolar −1..+1 reading lit out from
// the center-left/right of a 28-cell bar, plus a synthesized CURRENT PLAY line.
//
// DATA — all four rows come from feeds the Greeks tab already runs:
//   REGIME    ← gex  ($B, OI+Vol)  — sign/size of dealer net gamma
//   CONVEXITY ← RV vs IV + gamma regime — TRUE volatility expectancy (see below)
//   DEX LEAN  ← dex  ($B, OI+Vol)  — dealer delta lean
//   OPT SKEW  ← 25Δ put/call IV via derivePick(/api/gex) — same source as LiveSkewBand
//
// CONVEXITY = VOLATILITY EXPECTANCY, not "vol sensitivity". Long convexity (long
// gamma) has positive expectancy only when REALIZED vol beats what was IMPLIED —
// gamma-scalp P/L ≈ ½·Γ·(realized move)² − θ. So the row is a bipolar RV-vs-IV
// read, tilted by the dealer gamma regime (positive GEX suppresses future RV via
// sell-rallies/buy-dips hedging; negative GEX amplifies it):
//
//   rvIv    = tanh( ln(RV / IV) / RVIV_SOFT )   >0 ⇒ RV beating IV ⇒ long convexity pays
//   gexTilt = −tanh( GEX / SCALE.gex )          short gamma ⇒ future RV expands
//   v       = W_RVIV·rvIv + W_GEX·gexTilt
//
// RV is annualized from the panel's own spot samples (close-to-close log returns,
// RTH-time annualization). IV is the live ATM 0DTE IV from the chain. Rule of 16:
// IV/16 ≈ the daily move the market is charging for — shown in the row's readout.
//
// NORMALIZATION — everything is squashed to −1..+1 with tanh(x / SCALE). The
// SCALEs below are the "typical full-scale" magnitude for SPX; tune them here
// and nowhere else. A rolling z-score against gex_levels_history would be the
// stricter approach — these fixed scales are the v1.

import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { derivePick, type ChainRow as SkewChainRow } from "@/components/greeks/SkewCalculator";

// ── Tuning ────────────────────────────────────────────────────────────────────
// Calibrated against live SPX 0DTE readings (gex ≈ 68B, dex ≈ 32B, skew ≈ 106%).
// These sit the CURRENT tape around 0.6–0.7 of full scale, leaving headroom for a
// genuinely extreme day to peg the bar. Re-check with DEBUG_SCALES after a few
// sessions — if the bars never leave the middle, shrink these.
const SCALE = {
  gex: 80,    // $B net GEX that reads as "fully long gamma"
  dex: 40,    // $B net DEX that reads as "fully leaned"
  skew: 120,  // % (put−call)/atm that reads as "puts fully bid" — 0DTE wings run HOT,
              // nothing like the 10–30% textbook equity skew. See note below.
};
// How far RV must diverge from IV to peg the convexity bar. ln-ratio units:
// 0.35 ≈ RV 40% above IV (or ~30% below) reads as full-scale.
const RVIV_SOFT = 0.35;
const W_RVIV = 0.65;  // weight: what the tape is ACTUALLY doing
const W_GEX  = 0.35;  // weight: what dealer hedging will DO to it next
// TEMP: logs the raw feed values + where each bar lands, so SCALE can be tuned
// against real magnitudes. Flip to false (or delete the effect) once calibrated.
const DEBUG_SCALES = true;
const DEAD = 0.15;   // |v| below this = the neutral/mid label
const CELLS = 28;    // segments per bar
const SKEW_MS = 60_000;
// RTH seconds per year (252 × 6.5h) — annualize intraday samples in trading time.
const RTH_SECONDS_PER_YEAR = 252 * 6.5 * 3600;
const MIN_RV_SAMPLES = 8;

const tanh = (x: number) => Math.tanh(x);
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

export interface StateRailProps {
  gex: number | null;   // billions, OI+Vol
  dex: number | null;   // billions, OI+Vol
  vex: number | null;   // millions, OI+Vol (kept for the readout; not the convexity driver)
  /** Spot samples for realized vol. Ascending ts (ms). Panel already has these. */
  spots?: { ts: number; px: number }[];
  hasData?: boolean;
}

type Row = {
  key: string;
  sub: string;
  v: number;            // −1..+1
  label: string;
  color: string;
  note?: string;        // small mono readout under the label (e.g. RV/IV)
};

const C = {
  green: "#22c55e",
  red: HOME_THEME.red,
  amber: HOME_THEME.orange,
  dim: "#7d8896",
  off: "rgba(255,255,255,0.05)",
};

// ── Row derivations ───────────────────────────────────────────────────────────
function regimeRow(gex: number): Row {
  const v = clamp1(tanh(gex / SCALE.gex));
  const label = Math.abs(v) < DEAD ? "(~) TRANSITION" : v > 0 ? "LONG GAMMA" : "SHORT GAMMA";
  const color = Math.abs(v) < DEAD ? C.dim : v > 0 ? C.green : C.red;
  return { key: "REGIME", sub: "dealer structure", v, label, color };
}

/**
 * Realized vol, annualized %, from close-to-close log returns of the spot samples.
 * Annualized in TRADING time (RTH seconds/yr) so it's directly comparable to the
 * IV the chain quotes. Returns null until there are enough samples to mean anything.
 */
export function realizedVol(spots: { ts: number; px: number }[]): number | null {
  const pts = spots.filter(s => Number.isFinite(s.px) && s.px > 0 && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
  if (pts.length < MIN_RV_SAMPLES) return null;

  const rets: number[] = [];
  const dts: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].ts - pts[i - 1].ts) / 1000; // seconds
    if (dt <= 0 || dt > 3600) continue;            // skip dupes and overnight gaps
    rets.push(Math.log(pts[i].px / pts[i - 1].px));
    dts.push(dt);
  }
  if (rets.length < MIN_RV_SAMPLES - 1) return null;

  // Zero-mean stdev — intraday drift is noise, not signal, at this horizon.
  const variance = rets.reduce((s, r) => s + r * r, 0) / rets.length;
  const sorted = [...dts].sort((a, b) => a - b);
  const medianDt = sorted[Math.floor(sorted.length / 2)];
  if (!medianDt) return null;

  const perYear = RTH_SECONDS_PER_YEAR / medianDt;
  return Math.sqrt(variance * perYear) * 100;
}

/**
 * CONVEXITY = volatility expectancy. Bipolar:
 *   −1  RV running under IV + dealers long gamma  → vol suppressed, SELL convexity
 *    0  RV ≈ IV                                    → fairly priced
 *   +1  RV beating IV + dealers short gamma        → expansion, BUY convexity
 * The gamma-scalp identity (½·Γ·move² − θ) is why this is the right axis: gamma
 * only pays if the tape delivers more than the premium charged for it.
 */
function convexityRow(gex: number, rv: number | null, iv: number | null): Row {
  const gexTilt = -clamp1(tanh(gex / SCALE.gex)); // short gamma ⇒ RV expands next

  // RV under 1% annualized means the spot buffer is degenerate (identical samples:
  // market closed, or spot frozen because the WS is only sending `gex` deltas and
  // no `snapshot`). Treat that as NO DATA — a zero RV would otherwise pin the bar
  // hard negative and print a confident, fabricated "SUPPRESSED".
  const rvUsable = rv != null && rv > 1;
  if (!rvUsable || iv == null || iv <= 0) {
    // Fall back to the regime tilt alone, at reduced conviction.
    const v = clamp1(gexTilt * 0.5);
    return {
      key: "CONVEXITY", sub: "volatility expectancy", v,
      label: v > DEAD ? "EXPANSION (EST)" : v < -DEAD ? "SUPPRESSED (EST)" : "FAIR (EST)",
      color: C.dim,
      note: rv != null && rv <= 1 ? "spot frozen — no RV" : "RV warming…",
    };
  }

  const rvIv = clamp1(tanh(Math.log(Math.max(rv, 0.5) / Math.max(iv, 0.5)) / RVIV_SOFT));
  const v = clamp1(W_RVIV * rvIv + W_GEX * gexTilt);

  const label = v > DEAD ? "EXPANSION" : v < -DEAD ? "SUPPRESSED" : "FAIRLY PRICED";
  const color = v > DEAD ? C.amber : v < -DEAD ? C.green : C.dim;
  // Rule of 16: IV/16 = the daily move the market is charging for.
  const note = `RV ${rv.toFixed(1)} / IV ${iv.toFixed(1)} · ±${(iv / 16).toFixed(2)}%/d`;

  return { key: "CONVEXITY", sub: "volatility expectancy", v, label, color, note };
}

function dexRow(dex: number): Row {
  const v = clamp1(tanh(dex / SCALE.dex));
  const label = Math.abs(v) < DEAD ? "FLAT" : v > 0 ? "DEALER BUY" : "DEALER SELL";
  const color = Math.abs(v) < DEAD ? C.dim : v > 0 ? C.red : C.green;
  return { key: "DEX LEAN", sub: "delta flow", v, label, color };
}

function skewRow(skewPct: number | null): Row {
  if (skewPct == null) {
    return { key: "OPT SKEW", sub: "volatility surface", v: 0, label: "—", color: C.dim };
  }
  const v = clamp1(tanh(skewPct / SCALE.skew));
  const label = Math.abs(v) < DEAD ? "NEUTRAL" : v > 0 ? "PUTS BID" : "CALLS BID";
  const color = Math.abs(v) < DEAD ? C.dim : v > 0 ? C.red : C.green;
  return { key: "OPT SKEW", sub: "volatility surface", v, label, color };
}

// CURRENT PLAY — regime says what dealers DO, convexity says whether vol is
// CHEAP or RICH relative to what the tape is delivering. Those two together give
// the premium decision; DEX only sizes/directs it. Conflict = stand aside.
function currentPlay(regime: Row, conv: Row, dex: Row) {
  const longGamma = regime.v > DEAD;
  const shortGamma = regime.v < -DEAD;
  const expansion = conv.v > DEAD;    // RV beating IV → long convexity has edge
  const suppressed = conv.v < -DEAD;  // RV under IV → short convexity has edge
  const leaning = Math.abs(dex.v) > DEAD;

  if (!longGamma && !shortGamma) {
    return { text: "Regime in transition — no dealer edge to lean on.", chip: "STAND ASIDE", tone: C.amber };
  }
  if (longGamma && suppressed) {
    return { text: "Dealers pin and RV is under IV — premium is rich. Sell convexity, fade extremes.", chip: "SELL PREMIUM", tone: C.green };
  }
  if (shortGamma && expansion) {
    return { text: "Short gamma and RV beating IV — hedging amplifies. Own convexity, press the move.", chip: "BUY CONVEXITY", tone: C.red };
  }
  if (longGamma && expansion) {
    // The tape is outrunning a book that should be damping it — pin is failing.
    return { text: "RV outrunning IV against long-gamma dealers — pin is failing, wait for the flip break.", chip: "STAND ASIDE", tone: C.amber };
  }
  if (shortGamma && suppressed) {
    return { text: "Short gamma but RV under IV — coiled, not moving yet. Wait for the break, don't pay up.", chip: "WAIT / COILED", tone: C.amber };
  }
  if (longGamma) {
    return { text: `Long gamma, vol fairly priced${leaning ? " — flow leaning into the pin" : ""}. Range trade, no premium edge.`, chip: "FADE RANGE", tone: C.green };
  }
  return { text: "Short gamma, vol fairly priced — trend but size it down.", chip: "TREND (LIGHT)", tone: C.amber };
}

// ── Bar ───────────────────────────────────────────────────────────────────────
function SegBar({ row }: { row: Row }) {
  const mag = Math.min(1, Math.abs(row.v));
  const lit = Math.round(mag * CELLS);
  const fromRight = row.v < 0;

  return (
    <div style={{ display: "flex", gap: 2, height: 14 }}>
      {Array.from({ length: CELLS }, (_, j) => {
        const on = fromRight ? j >= CELLS - lit : j < lit;
        // Ramp brightness toward the outer (extreme) end of the lit run.
        const depth = fromRight ? (CELLS - j) / CELLS : (j + 1) / CELLS;
        return (
          <i
            key={j}
            style={{
              flex: 1,
              borderRadius: 1,
              background: on ? row.color : C.off,
              opacity: on ? 0.35 + 0.65 * depth : 1,
              boxShadow: on ? `0 0 6px ${row.color}55` : "none",
              transition: "background .5s, opacity .5s, box-shadow .5s",
            }}
          />
        );
      })}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export default function StateRail({ gex, dex, spots = [], hasData = true }: StateRailProps) {
  const [skewPct, setSkewPct] = useState<number | null>(null);
  const [atmIv, setAtmIv] = useState<number | null>(null);  // ATM 0DTE IV, % annualized
  // Own spot series off /api/gex. The WS spot has proven unreliable (frozen at its
  // seed during `gex`-delta streams → RV of exactly 0), so we don't depend on it:
  // whichever series has more movement wins below.
  const [ownSpots, setOwnSpots] = useState<{ ts: number; px: number }[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Same 0DTE chain feed LiveSkewBand uses — one source of truth for skew, for the
  // ATM IV that convexity is measured against, and for the fallback spot series.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/gex", { cache: "no-store" });
        const j = res.ok ? await res.json() : null;
        const spot = Number(j?.spotPrice ?? 0);
        const pick = j ? derivePick(
          (Array.isArray(j.chain) ? j.chain : []) as SkewChainRow[],
          spot,
          j.expiration ?? null,
        ) : null;
        if (!mounted.current) return;
        setSkewPct(pick && pick.atm > 0 ? ((pick.put - pick.call) / pick.atm) * 100 : null);
        setAtmIv(pick && pick.atm > 0 ? pick.atm : null);
        if (spot > 0) setOwnSpots(prev => [...prev, { ts: Date.now(), px: spot }].slice(-400));
      } catch { /* leave last value */ }
    };
    load();
    const id = setInterval(load, SKEW_MS);
    return () => clearInterval(id);
  }, []);

  const g = Number(gex ?? 0);
  const d = Number(dex ?? 0);

  // RV from whichever spot series is actually alive. A dead (frozen) series yields
  // null via realizedVol's degenerate-variance guard, so prefer the one that prints.
  const rv = useMemo(() => {
    const fromProps = realizedVol(spots);
    if (fromProps != null && fromProps > 1) return fromProps;
    return realizedVol(ownSpots);
  }, [spots, ownSpots]);

  // ── TEMP: scale calibration. Watch these for a session, then set SCALE.* to the
  // magnitude of a NOTABLE reading (not a typical one) so the bars stop saturating.
  // Delete once the scales are tuned. ──
  useEffect(() => {
    if (!DEBUG_SCALES) return;
    const n = (x: number | null | undefined, d = 2) =>
      x == null || !Number.isFinite(x) ? "null" : x.toFixed(d);
    const lastPx = spots.length ? spots[spots.length - 1].px : null;
    console.log(
      `[StateRail] gex=${n(g)}B dex=${n(d)}B | rv=${n(rv, 1)} iv=${n(atmIv, 1)} skew=${n(skewPct, 1)}% ` +
      `| spots=${spots.length} lastSpot=${n(lastPx)} ` +
      `| bars regime=${n(tanh(g / SCALE.gex))} dex=${n(tanh(d / SCALE.dex))} ` +
      `skew=${skewPct == null ? "null" : n(tanh(skewPct / SCALE.skew))}`,
    );
  }, [g, d, rv, atmIv, skewPct, spots]);

  const rows: Row[] = [
    regimeRow(g),
    convexityRow(g, rv, atmIv),
    dexRow(d),
    skewRow(skewPct),
  ];
  const play = currentPlay(rows[0], rows[1], rows[2]);

  return (
    <section
      style={{
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 14,
        padding: 14,
        background: HOME_THEME.panelBg,
        fontFamily: "var(--font-mono)",
        opacity: hasData ? 1 : 0.45,
      }}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "150px 1fr 165px",
            alignItems: "center",
            gap: 14,
            padding: "5px 0",
          }}
        >
          <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, letterSpacing: ".1em", color: "#fff" }}>
            {row.key}
            <span style={{ display: "block", fontSize: 10, fontWeight: 400, letterSpacing: ".06em", color: C.dim, marginTop: 2 }}>
              {row.sub}
            </span>
          </div>
          <SegBar row={row} />
          <div>
            <div style={{ fontSize: 10, letterSpacing: ".1em", color: row.color }}>{row.label}</div>
            {row.note && (
              <div style={{ fontSize: 10, letterSpacing: ".04em", color: C.dim, marginTop: 2 }}>{row.note}</div>
            )}
          </div>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          borderTop: `1px solid ${HOME_THEME.border}`,
          marginTop: 12,
          paddingTop: 12,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", color: "#fff" }}>CURRENT PLAY</span>
        <span style={{ flex: 1, textAlign: "right", fontSize: 10, letterSpacing: ".08em", color: C.dim }}>
          {hasData ? play.text : "Awaiting live greeks…"}
        </span>
        <span
          style={{
            border: `1px solid ${play.tone}`,
            color: play.tone,
            borderRadius: 5,
            padding: "4px 10px",
            fontSize: 10,
            letterSpacing: ".12em",
            whiteSpace: "nowrap",
          }}
        >
          {hasData ? play.chip : "—"}
        </span>
      </div>
    </section>
  );
}
