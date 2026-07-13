"use client";

// StateRail — the 4-row dealer-state rail for the Greeks home tab (treatment A:
// segmented power bars). Four rows, each a bipolar −1..+1 reading lit out from
// the center-left/right of a 28-cell bar, plus a synthesized CURRENT PLAY line.
//
// DATA — all four rows come from feeds the Greeks tab already runs:
//   REGIME    ← gex  ($B, OI+Vol)  — sign/size of dealer net gamma
//   CONVEXITY ← vex ($M) + |gex|   — vol expectancy (UNIPOLAR: calm → explosive)
//   DEX LEAN  ← dex  ($B, OI+Vol)  — dealer delta lean
//   OPT SKEW  ← 25Δ put/call IV via derivePick(/api/gex) — same source as LiveSkewBand
//
// NORMALIZATION — raw greeks are squashed to −1..+1 with tanh(x / SCALE). The
// SCALEs below are the "typical full-scale" magnitude for SPX; tune them here
// and nowhere else. A rolling z-score against gex_levels_history would be the
// stricter approach — these fixed scales are the v1.

import { useEffect, useRef, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { derivePick, type ChainRow as SkewChainRow } from "@/components/greeks/SkewCalculator";

// ── Tuning ────────────────────────────────────────────────────────────────────
const SCALE = {
  gex: 4,    // $B net GEX that reads as "fully long gamma"
  dex: 8,    // $B net DEX that reads as "fully leaned"
  vex: 250,  // $M net VEX that reads as "fully vol-sensitive"
  skew: 12,  // % (put−call)/atm that reads as "puts fully bid"
};
const DEAD = 0.15;   // |v| below this = the neutral/mid label
const CELLS = 28;    // segments per bar
const SKEW_MS = 60_000;

const tanh = (x: number) => Math.tanh(x);
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

export interface StateRailProps {
  gex: number | null;   // billions, OI+Vol
  dex: number | null;   // billions, OI+Vol
  vex: number | null;   // millions, OI+Vol
  hasData?: boolean;
}

type Row = {
  key: string;
  sub: string;
  v: number;            // −1..+1  (unipolar rows use 0..+1)
  label: string;
  color: string;
  unipolar?: boolean;
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

// Convexity is unipolar 0..1: high when dealers have little gamma to absorb with
// (small |gex|) AND the book is vol-sensitive (large |vex|). Explosive = 1.
function convexityRow(gex: number, vex: number): Row {
  const volSensitivity = Math.min(1, Math.abs(tanh(vex / SCALE.vex)));
  const gammaCushion = Math.min(1, Math.abs(tanh(gex / SCALE.gex)));
  const v = clamp1(volSensitivity * (1 - gammaCushion * 0.7));
  const label = v < 0.3 ? "CALM" : v < 0.6 ? "COILED" : "EXPLOSIVE";
  return { key: "CONVEXITY", sub: "volatility expectancy", v, label, color: C.amber, unipolar: true };
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

// CURRENT PLAY — structure (regime) and flow (dex) must agree, and convexity
// decides whether it's a fade or a chase. Conflict = stand aside.
function currentPlay(regime: Row, conv: Row, dex: Row) {
  const longGamma = regime.v > DEAD;
  const shortGamma = regime.v < -DEAD;
  const explosive = conv.v >= 0.6;
  const dealerBuy = dex.v > DEAD;
  const dealerSell = dex.v < -DEAD;

  if (!longGamma && !shortGamma) {
    return { text: "Regime in transition — no dealer edge to lean on.", chip: "STAND ASIDE", tone: C.amber };
  }
  if (longGamma && explosive) {
    return { text: "Signals conflict — flow fights structure, wait.", chip: "STAND ASIDE", tone: C.amber };
  }
  if (longGamma && (dealerBuy || dealerSell)) {
    return { text: "Long gamma — dealers pin. Fade the extremes into the flip.", chip: "FADE RANGE", tone: C.green };
  }
  if (shortGamma && explosive) {
    return { text: "Short gamma + convex — dealers chase. Momentum has legs.", chip: "PRESS TREND", tone: C.red };
  }
  if (shortGamma) {
    return { text: "Short gamma, calm surface — trend but size it down.", chip: "TREND (LIGHT)", tone: C.amber };
  }
  return { text: "Mixed read — wait for structure and flow to line up.", chip: "STAND ASIDE", tone: C.amber };
}

// ── Bar ───────────────────────────────────────────────────────────────────────
function SegBar({ row }: { row: Row }) {
  const mag = Math.min(1, Math.abs(row.v));
  const lit = Math.round(mag * CELLS);
  const fromRight = !row.unipolar && row.v < 0;

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
export default function StateRail({ gex, dex, vex, hasData = true }: StateRailProps) {
  const [skewPct, setSkewPct] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Same 0DTE chain feed LiveSkewBand uses — one source of truth for skew.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/gex", { cache: "no-store" });
        const j = res.ok ? await res.json() : null;
        const pick = j ? derivePick(
          (Array.isArray(j.chain) ? j.chain : []) as SkewChainRow[],
          Number(j.spotPrice ?? 0),
          j.expiration ?? null,
        ) : null;
        if (!mounted.current) return;
        setSkewPct(pick && pick.atm > 0 ? ((pick.put - pick.call) / pick.atm) * 100 : null);
      } catch { /* leave last value */ }
    };
    load();
    const id = setInterval(load, SKEW_MS);
    return () => clearInterval(id);
  }, []);

  const g = Number(gex ?? 0);
  const d = Number(dex ?? 0);
  const v = Number(vex ?? 0);

  const rows: Row[] = [
    regimeRow(g),
    convexityRow(g, v),
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
            gridTemplateColumns: "150px 1fr 130px",
            alignItems: "center",
            gap: 14,
            padding: "5px 0",
          }}
        >
          <div style={{ textAlign: "right", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#fff" }}>
            {row.key}
            <span style={{ display: "block", fontSize: 8, fontWeight: 400, letterSpacing: ".06em", color: C.dim, marginTop: 2 }}>
              {row.sub}
            </span>
          </div>
          <SegBar row={row} />
          <div style={{ fontSize: 10, letterSpacing: ".1em", color: row.color }}>{row.label}</div>
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
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#fff" }}>CURRENT PLAY</span>
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
