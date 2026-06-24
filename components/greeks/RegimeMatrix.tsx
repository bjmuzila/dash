"use client";

/* ────────────────────────────────────────────────────────────────────────────
 * Options Flow Regime Canvas
 *
 * A 4-Greek matrix (GEX × VEX rows, DEX × CEX columns → 16 regimes) that maps
 * the live sign of each dealer-exposure Greek to a named market regime.
 *
 *   • The cell matching the live signs is HARD-highlighted (the "correct" one).
 *   • The four cells reachable by flipping exactly ONE Greek are LIGHT-highlighted
 *     (the regimes one move away — what it becomes if a single Greek flips).
 *
 * Signs come from the Greeks page's live latest values:
 *   row  = (sign(GEX), sign(VEX))
 *   col  = (sign(DEX), sign(CEX))   where CEX == CHEX (charm exposure).
 *
 * Pure presentational: pass the four numeric Greeks (or null while loading).
 * ──────────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";

// A regime "key" is the 4 signs in fixed order: gex, vex, dex, cex.
type Sign = 1 | -1;
interface Cell {
  gex: Sign; vex: Sign; dex: Sign; cex: Sign;
  name: string;
  tone: "bull" | "bear" | "mixed";
  behavior: string;
  price: string;
  implication: string;
  /** normalized [0..1] points for the mini price-action curve (left→right) */
  curve: number[];
}

// ── Row / column headers ──────────────────────────────────────────────────────
// Rows vary GEX (outer) then VEX (inner); columns vary DEX (outer) then CEX.
const ROW_DEFS = [
  { gex: 1 as Sign,  vex: 1 as Sign,  label: "+ GEX / + VEX",  sub: "Stabilized Bull" },
  { gex: 1 as Sign,  vex: -1 as Sign, label: "+ GEX / − VEX",  sub: "Suppressed Chop" },
  { gex: -1 as Sign, vex: 1 as Sign,  label: "− GEX / + VEX",  sub: "Volatile Bull" },
  { gex: -1 as Sign, vex: -1 as Sign, label: "− GEX / − VEX",  sub: "Volatile Bear" },
];
const COL_DEFS = [
  { dex: 1 as Sign,  cex: 1 as Sign,  label: "+ DEX / + CEX",  sub: "Bullish & Late Bid" },
  { dex: 1 as Sign,  cex: -1 as Sign, label: "+ DEX / − CEX",  sub: "Bullish w/ Late Fade" },
  { dex: -1 as Sign, cex: 1 as Sign,  label: "− DEX / + CEX",  sub: "Bearish w/ Late Bid" },
  { dex: -1 as Sign, cex: -1 as Sign, label: "− DEX / − CEX",  sub: "Bearish & Late Drag" },
];

// ── The 16 regimes ────────────────────────────────────────────────────────────
// Indexed [rowIdx][colIdx]. Content authored in the same dealer-flow framing the
// rest of the page uses: GEX = vol suppression/amplification, DEX = directional
// hedging bias, CEX (charm) = time-decay drift into the close, VEX (vanna) =
// IV-sensitivity of dealer hedges.
const GRID: Cell[][] = [
  // ── Row 0: + GEX / + VEX  (Stabilized Bull) ──────────────────────────────────
  [
    {
      gex: 1, vex: 1, dex: 1, cex: 1, name: "Vanna-Charm Melt-Up", tone: "bull",
      behavior: "Positive gamma pins, positive vanna and charm both feed dealer buying. Every Greek leans the same way — the cleanest grind-higher tape.",
      price: "Low-vol staircase higher; shallow dips bought, closes near the highs.",
      implication: "Trend-follow longs / call debit spreads. Buy dips toward the gamma wall; let charm carry into the close.",
      curve: [0.55, 0.5, 0.52, 0.46, 0.4, 0.36, 0.3, 0.24, 0.2],
    },
    {
      gex: 1, vex: 1, dex: 1, cex: -1, name: "Afternoon Grind w/ Late Fade", tone: "bull",
      behavior: "Bullish gamma + vanna hold through midday, but negative charm pulls dealer delta off into the close.",
      price: "Morning drift up, then a flattening / slight fade in the final hour.",
      implication: "Long early, trim into 2–3 PM ET. Avoid holding 0DTE calls into the charm drag.",
      curve: [0.55, 0.5, 0.45, 0.4, 0.36, 0.34, 0.36, 0.42, 0.48],
    },
    {
      gex: 1, vex: 1, dex: -1, cex: 1, name: "Capped Bull Drift", tone: "mixed",
      behavior: "Gamma + vanna are constructive, but negative DEX means dealers carry short-delta inventory — overhead supply caps rallies.",
      price: "Grinds up into resistance, stalls at the wall, mean-reverts.",
      implication: "Range / fade-the-highs near the call wall. Iron condors favored; small upside only.",
      curve: [0.55, 0.48, 0.42, 0.4, 0.42, 0.4, 0.42, 0.4, 0.42],
    },
    {
      gex: 1, vex: 1, dex: -1, cex: -1, name: "Stabilized Trap", tone: "mixed",
      behavior: "Strong pin (positive gamma) masks a bearish lean — short dealer delta plus negative charm both drag late.",
      price: "Quiet, deceptively calm tape that leaks lower into the close.",
      implication: "Sell rallies / lean short late. Don't trust the calm — the late drag is the tell.",
      curve: [0.42, 0.44, 0.42, 0.44, 0.46, 0.48, 0.52, 0.56, 0.6],
    },
  ],
  // ── Row 1: + GEX / − VEX  (Suppressed Chop) ──────────────────────────────────
  [
    {
      gex: 1, vex: -1, dex: 1, cex: 1, name: "Vol-Chop with EOD Lift", tone: "bull",
      behavior: "Positive gamma suppresses range; negative vanna fights it, but positive DEX + charm tilt the close upward.",
      price: "Choppy, compressed range that lifts into the final hour.",
      implication: "Theta/condor through midday, flip to a late long for the charm lift. Scalp the range, not the trend.",
      curve: [0.5, 0.46, 0.5, 0.46, 0.5, 0.46, 0.42, 0.36, 0.3],
    },
    {
      gex: 1, vex: -1, dex: 1, cex: -1, name: "Vol-Dependent Chop", tone: "mixed",
      behavior: "Gamma pins, but vanna and charm both pull against the bullish DEX. Direction is entirely IV-dependent.",
      price: "Sideways grind; whichever way IV breaks decides the day.",
      implication: "Stay neutral / sell premium until IV picks a side. Watch VIX1D vs VIX for the tell.",
      curve: [0.48, 0.5, 0.47, 0.5, 0.48, 0.5, 0.48, 0.5, 0.48],
    },
    {
      gex: 1, vex: -1, dex: -1, cex: 1, name: "Orderly Retreat with Support", tone: "mixed",
      behavior: "Bearish DEX leads, but positive gamma + charm cushion the move — orderly, not disorderly.",
      price: "Controlled grind lower with intraday bounces off the put wall.",
      implication: "Sell rips into resistance; respect the gamma support below. No cascade expected.",
      curve: [0.38, 0.42, 0.46, 0.44, 0.5, 0.48, 0.54, 0.52, 0.56],
    },
    {
      gex: 1, vex: -1, dex: -1, cex: -1, name: "Managed Decline", tone: "bear",
      behavior: "DEX, VEX and charm all lean bearish; only positive gamma keeps the decline orderly rather than a crash.",
      price: "Steady, low-vol bleed lower into the close.",
      implication: "Short bias / put debit spreads with disciplined stops. Trend down, but no panic.",
      curve: [0.34, 0.38, 0.42, 0.46, 0.5, 0.54, 0.58, 0.62, 0.66],
    },
  ],
  // ── Row 2: − GEX / + VEX  (Volatile Bull) ────────────────────────────────────
  [
    {
      gex: -1, vex: 1, dex: 1, cex: 1, name: "Explosive Rocket", tone: "bull",
      behavior: "Negative gamma amplifies, and DEX, VEX and charm all push up. Dealers chase upside — squeeze fuel.",
      price: "Sharp, accelerating rally; gap-and-go, expanding range.",
      implication: "Momentum longs / long calls. Don't fade strength — ride it with trailing stops.",
      curve: [0.6, 0.58, 0.52, 0.44, 0.34, 0.26, 0.2, 0.14, 0.08],
    },
    {
      gex: -1, vex: 1, dex: 1, cex: -1, name: "Rocket with Late Pullback", tone: "bull",
      behavior: "Amplifying gamma + bullish DEX/vanna drive a rally, but negative charm bleeds delta into the close.",
      price: "Strong morning rip, then a sharp give-back in the last hour.",
      implication: "Ride the early momentum, exit 0DTE calls before the charm reversal. Don't round-trip it.",
      curve: [0.6, 0.55, 0.45, 0.32, 0.24, 0.22, 0.28, 0.38, 0.46],
    },
    {
      gex: -1, vex: 1, dex: -1, cex: 1, name: "Fake-Out Factory", tone: "mixed",
      behavior: "Negative gamma whipsaws; bearish DEX vs supportive charm/vanna means failed breaks in both directions.",
      price: "Violent two-sided whipsaw; breakouts trap, then reverse.",
      implication: "Fade extremes, avoid breakout entries. Tight risk — this regime punishes conviction.",
      curve: [0.45, 0.3, 0.5, 0.28, 0.55, 0.32, 0.5, 0.35, 0.48],
    },
    {
      gex: -1, vex: 1, dex: -1, cex: -1, name: "Unstable Squeeze Trap", tone: "mixed",
      behavior: "Bearish DEX + charm with amplifying gamma, but live vanna can spark vicious counter-trend squeezes.",
      price: "Lower bias punctuated by sharp, unsustainable short-squeezes.",
      implication: "Short with caution; expect violent bounces. Size small, take profits fast.",
      curve: [0.4, 0.5, 0.34, 0.48, 0.4, 0.54, 0.46, 0.6, 0.56],
    },
  ],
  // ── Row 3: − GEX / − VEX  (Volatile Bear) ────────────────────────────────────
  [
    {
      gex: -1, vex: -1, dex: 1, cex: 1, name: "Bearish Grind w/ Late Support", tone: "mixed",
      behavior: "Amplifying gamma + negative vanna lean bearish, but bullish DEX + charm fight back into the close.",
      price: "Heavy, sloppy tape that finds a late bid and closes off the lows.",
      implication: "Counter-trend late longs only; the morning belongs to sellers. Wait for the charm turn.",
      curve: [0.45, 0.52, 0.58, 0.62, 0.6, 0.56, 0.48, 0.42, 0.38],
    },
    {
      gex: -1, vex: -1, dex: 1, cex: -1, name: "Accelerated Bleed", tone: "bear",
      behavior: "Negative gamma + vanna + charm all amplify downside; positive DEX is the lone, fading counterweight.",
      price: "Persistent, accelerating sell-off; bounces sold quickly.",
      implication: "Momentum shorts / put spreads. Heavy hedging; don't catch the falling knife.",
      curve: [0.4, 0.46, 0.54, 0.6, 0.66, 0.72, 0.78, 0.84, 0.9],
    },
    {
      gex: -1, vex: -1, dex: -1, cex: 1, name: "Doom Loop w/ EOD Cushion", tone: "bear",
      behavior: "GEX, VEX and DEX all bearish and amplifying; only positive charm offers a thin late cushion.",
      price: "Liquidity-thin slide lower; a small, unreliable bounce into the bell.",
      implication: "Defensive / short. Treat any late bounce as an exit, not an entry.",
      curve: [0.42, 0.5, 0.58, 0.66, 0.74, 0.8, 0.82, 0.78, 0.74],
    },
    {
      gex: -1, vex: -1, dex: -1, cex: -1, name: "Full Doom Cascade", tone: "bear",
      behavior: "All four Greeks negative: amplifying gamma, vanna selling, bearish delta, charm drag. Maximum downside alignment.",
      price: "Rapid, liquidity-evaporating crashes; little to no support.",
      implication: "Defensive only. Heavy hedging required — long puts / spreads, minimal size, expect gaps.",
      curve: [0.4, 0.44, 0.5, 0.58, 0.68, 0.8, 0.9, 0.95, 0.98],
    },
  ],
];

// Sign of a numeric Greek; treat exactly-0 or null as positive-leaning so the
// matrix always resolves to a concrete cell (matches the page's >=0 convention).
function signOf(v: number | null | undefined): Sign {
  return v != null && v < 0 ? -1 : 1;
}

const TONE_COLOR: Record<Cell["tone"], string> = {
  bull: "#00e676",
  bear: "#ff5252",
  mixed: "#facc15",
};

export default function RegimeMatrix({
  gex, dex, chex, vex, hasData,
}: {
  gex: number | null;
  dex: number | null;
  chex: number | null;   // CEX
  vex: number | null;
  hasData: boolean;
}) {
  // Live signs → active row/col.
  const liveRow = useMemo(
    () => ROW_DEFS.findIndex(r => r.gex === signOf(gex) && r.vex === signOf(vex)),
    [gex, vex],
  );
  const liveCol = useMemo(
    () => COL_DEFS.findIndex(c => c.dex === signOf(dex) && c.cex === signOf(chex)),
    [dex, chex],
  );

  // User can click any cell to inspect it; defaults to the live cell.
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const activeR = sel?.r ?? (liveRow >= 0 ? liveRow : 0);
  const activeC = sel?.c ?? (liveCol >= 0 ? liveCol : 0);
  const detail = GRID[activeR][activeC];

  // One-flip adjacency: a cell is "one Greek away" from the LIVE cell if exactly
  // one of its four signs differs from the live signs. There are always 4.
  const isOneFlip = (r: number, c: number): boolean => {
    if (liveRow < 0 || liveCol < 0) return false;
    if (r === liveRow && c === liveCol) return false;
    const cell = GRID[r][c];
    const live = GRID[liveRow][liveCol];
    let diff = 0;
    if (cell.gex !== live.gex) diff++;
    if (cell.vex !== live.vex) diff++;
    if (cell.dex !== live.dex) diff++;
    if (cell.cex !== live.cex) diff++;
    return diff === 1;
  };

  const detailColor = TONE_COLOR[detail.tone];

  return (
    <section style={{
      border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, marginBottom: 16,
      background: "linear-gradient(180deg,rgba(8,12,18,.6),rgba(0,0,0,.3))", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 12, padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", flexWrap: "wrap",
      }}>
        <div style={{ maxWidth: 620 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#67e8f9", letterSpacing: ".02em" }}>
            Options Flow Regime Canvas
          </div>
          <div style={{ fontSize: 11.5, color: "#9fb3c8", marginTop: 3, lineHeight: 1.5 }}>
            4-Greek matrix tracking Gamma (GEX), Vanna (VEX), Delta (DEX) and Charm (CEX).
            The live regime is highlighted; cells one Greek-flip away are dimly lit.
          </div>
        </div>
        {/* Live-sign legend + reset */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {[
            ["GEX", gex], ["VEX", vex], ["DEX", dex], ["CEX", chex],
          ].map(([lbl, v]) => {
            const s = signOf(v as number | null);
            const col = (v as number | null) == null ? "#9fb3c8" : s > 0 ? "#00e676" : "#ff5252";
            return (
              <span key={lbl as string} style={{
                fontSize: 10, fontWeight: 800, fontFamily: "monospace", color: col,
                border: `1px solid ${col}55`, background: `${col}14`, padding: "3px 7px", borderRadius: 5,
              }}>
                {lbl as string} {(v as number | null) == null ? "–" : s > 0 ? "+" : "−"}
              </span>
            );
          })}
          {sel && (
            <button onClick={() => setSel(null)} style={{
              fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
              color: "#67e8f9", border: "1px solid rgba(0,229,255,.35)", background: "rgba(0,229,255,.08)",
              padding: "4px 9px", borderRadius: 5, cursor: "pointer",
            }}>Reset to live</button>
          )}
        </div>
      </div>

      <div className="regime-body" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(0,1fr)", gap: 14, padding: 16 }}>
        {/* ── Selector grid ── */}
        <div style={{ minWidth: 0, overflowX: "auto" }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".1em",
            textTransform: "uppercase", marginBottom: 8,
          }}>Regime Selector Grid</div>

          {/* 5-col layout: corner + 4 column headers, then 4 labelled rows. */}
          <div style={{ display: "grid", gridTemplateColumns: "92px repeat(4, minmax(96px,1fr))", gap: 6, minWidth: 560 }}>
            {/* top-left corner cell */}
            <div style={{
              fontSize: 8.5, color: "#64748b", fontWeight: 700, display: "flex",
              alignItems: "flex-end", justifyContent: "flex-start", padding: "0 0 4px 2px", lineHeight: 1.3,
            }}>
              GEX·VEX ↓<br />DEX·CEX →
            </div>
            {/* column headers */}
            {COL_DEFS.map((c, ci) => {
              const live = ci === liveCol;
              return (
                <div key={ci} style={{
                  border: `1px solid ${live ? "rgba(0,229,255,.5)" : "rgba(255,255,255,.12)"}`,
                  background: live ? "rgba(0,229,255,.08)" : "rgba(255,255,255,.02)",
                  borderRadius: 8, padding: "6px 6px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: live ? "#67e8f9" : "#cdd9e5", fontFamily: "monospace" }}>{c.label}</div>
                  <div style={{ fontSize: 8, color: "#7e8ea0", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", marginTop: 2 }}>{c.sub}</div>
                </div>
              );
            })}

            {/* rows */}
            {ROW_DEFS.map((rd, ri) => {
              const liveRowHdr = ri === liveRow;
              return (
                <RowFragment
                  key={ri}
                  ri={ri}
                  rd={rd}
                  liveRowHdr={liveRowHdr}
                  liveRow={liveRow}
                  liveCol={liveCol}
                  activeR={activeR}
                  activeC={activeC}
                  isOneFlip={isOneFlip}
                  onPick={(r, c) => setSel({ r, c })}
                />
              );
            })}
          </div>

          {/* legend */}
          <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap", fontSize: 10, color: "#9fb3c8" }}>
            <Legend swatch="solid" label="Live regime (current signs)" />
            <Legend swatch="dim" label="One Greek-flip away" />
            <Legend swatch="bull" label="Bullish" />
            <Legend swatch="bear" label="Bearish" />
            <Legend swatch="mixed" label="Mixed / chop" />
          </div>
        </div>

        {/* ── Behavior demonstration ── */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".1em",
            textTransform: "uppercase", marginBottom: 8,
          }}>Behavior Demonstration</div>

          {/* price-action sketch */}
          <div style={{
            border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: 10, marginBottom: 10,
            background: "linear-gradient(180deg,rgba(5,8,13,.96),rgba(8,12,18,.92))",
          }}>
            <PriceSketch curve={detail.curve} color={detailColor} />
            <div style={{ fontSize: 8.5, color: "#64748b", letterSpacing: ".18em", textAlign: "right", marginTop: 2 }}>
              SIMULATED PRICE ACTION
            </div>
          </div>

          {/* detail card */}
          <div style={{
            border: `1px solid ${detailColor}55`, borderRadius: 10, padding: 14,
            background: `linear-gradient(180deg,${detailColor}12,rgba(0,0,0,.3))`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: "#eef7ff" }}>{detail.name}</div>
              {activeR === liveRow && activeC === liveCol && hasData && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: ".08em", color: "#00e676",
                  border: "1px solid rgba(0,230,118,.5)", background: "rgba(0,230,118,.12)",
                  padding: "2px 7px", borderRadius: 5,
                }}>● LIVE</span>
              )}
            </div>
            {/* sign chips */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {([["GEX", detail.gex], ["VEX", detail.vex], ["DEX", detail.dex], ["CEX", detail.cex]] as [string, Sign][]).map(([lbl, s]) => (
                <span key={lbl} style={{
                  fontSize: 9.5, fontWeight: 800, fontFamily: "monospace",
                  color: s > 0 ? "#00e676" : "#ff5252",
                  border: `1px solid ${s > 0 ? "rgba(0,230,118,.4)" : "rgba(255,82,82,.4)"}`,
                  borderRadius: 5, padding: "2px 7px",
                }}>{lbl} {s > 0 ? "+" : "−"}</span>
              ))}
            </div>

            <DetailRow label="Core Behavior" body={detail.behavior} />
            <DetailRow label="Price Action Expected" body={detail.price} />

            <div style={{
              marginTop: 10, border: "1px solid rgba(0,229,255,.25)", borderRadius: 8,
              background: "rgba(0,229,255,.06)", padding: "9px 11px",
            }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: "#67e8f9", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 3 }}>
                ◆ Trading Implications (0DTE / SPX)
              </div>
              <div style={{ fontSize: 12, color: "#d7e6e8", lineHeight: 1.5 }}>{detail.implication}</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 820px) { .regime-body { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  );
}

// ── A labelled row: row-header cell + 4 regime cells ──────────────────────────
function RowFragment({
  ri, rd, liveRowHdr, liveRow, liveCol, activeR, activeC, isOneFlip, onPick,
}: {
  ri: number;
  rd: { gex: Sign; vex: Sign; label: string; sub: string };
  liveRowHdr: boolean;
  liveRow: number;
  liveCol: number;
  activeR: number;
  activeC: number;
  isOneFlip: (r: number, c: number) => boolean;
  onPick: (r: number, c: number) => void;
}) {
  return (
    <>
      {/* row header */}
      <div style={{
        border: `1px solid ${liveRowHdr ? "rgba(0,229,255,.5)" : "rgba(255,255,255,.12)"}`,
        background: liveRowHdr ? "rgba(0,229,255,.08)" : "rgba(255,255,255,.02)",
        borderRadius: 8, padding: "6px 6px", display: "flex", flexDirection: "column", justifyContent: "center",
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: liveRowHdr ? "#67e8f9" : "#cdd9e5", fontFamily: "monospace" }}>{rd.label}</div>
        <div style={{ fontSize: 8, color: "#7e8ea0", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", marginTop: 2 }}>{rd.sub}</div>
      </div>

      {/* 4 regime cells */}
      {GRID[ri].map((cell, ci) => {
        const isLive = ri === liveRow && ci === liveCol;
        const isSelected = ri === activeR && ci === activeC;
        const oneFlip = isOneFlip(ri, ci);
        const tone = TONE_COLOR[cell.tone];

        // Layered visual state: live cell = solid tone glow; one-flip = dim tone;
        // selected (but not live) = cyan ring; otherwise neutral.
        const border =
          isLive ? `2px solid ${tone}`
          : isSelected ? "2px solid rgba(0,229,255,.8)"
          : oneFlip ? `1px solid ${tone}66`
          : "1px solid rgba(255,255,255,.08)";
        const bg =
          isLive ? `linear-gradient(180deg,${tone}33,${tone}10)`
          : oneFlip ? `${tone}12`
          : "rgba(255,255,255,.015)";
        const boxShadow = isLive ? `0 0 14px ${tone}55, inset 0 0 18px ${tone}18` : undefined;

        return (
          <button
            key={ci}
            onClick={() => onPick(ri, ci)}
            title={cell.name}
            style={{
              border, background: bg, boxShadow, borderRadius: 8, padding: "8px 7px",
              minHeight: 58, textAlign: "left", cursor: "pointer", position: "relative",
              display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4,
              transition: "transform .08s ease",
            }}
          >
            {isLive && (
              <span style={{
                position: "absolute", top: 4, right: 5, fontSize: 8, fontWeight: 900,
                color: tone, letterSpacing: ".06em",
              }}>● LIVE</span>
            )}
            <div style={{
              fontSize: 11, fontWeight: 800, lineHeight: 1.2,
              color: isLive ? "#ffffff" : oneFlip ? "#e3edf5" : "#9aa9bb",
            }}>{cell.name}</div>
            {/* mini sign row */}
            <div style={{ display: "flex", gap: 3, fontFamily: "monospace", fontSize: 8.5, fontWeight: 800 }}>
              <SignDot lbl="D" s={cell.dex} dim={!isLive && !oneFlip} />
              <SignDot lbl="C" s={cell.cex} dim={!isLive && !oneFlip} />
            </div>
          </button>
        );
      })}
    </>
  );
}

function SignDot({ lbl, s, dim }: { lbl: string; s: Sign; dim: boolean }) {
  const col = s > 0 ? "#00e676" : "#ff5252";
  return (
    <span style={{ color: dim ? `${col}99` : col, letterSpacing: ".02em" }}>
      {lbl}{s > 0 ? "+" : "−"}
    </span>
  );
}

function DetailRow({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#d7e6e8", lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: "solid" | "dim" | "bull" | "bear" | "mixed"; label: string }) {
  const map: Record<string, string> = {
    solid: "linear-gradient(180deg,rgba(0,230,118,.5),rgba(0,230,118,.15))",
    dim: "rgba(255,255,255,.10)",
    bull: TONE_COLOR.bull, bear: TONE_COLOR.bear, mixed: TONE_COLOR.mixed,
  };
  const border = swatch === "solid" ? "2px solid #00e676"
    : swatch === "dim" ? "1px solid rgba(255,255,255,.3)"
    : `1px solid ${map[swatch]}`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 13, height: 13, borderRadius: 3, background: map[swatch], border }} />
      {label}
    </span>
  );
}

// ── Mini price-action sketch (SVG) ────────────────────────────────────────────
// curve: array of normalized y-values (0 = top, 1 = bottom) sampled left→right.
function PriceSketch({ curve, color }: { curve: number[]; color: string }) {
  const W = 280, H = 90, padX = 6, padY = 8;
  const n = curve.length;
  const x = (i: number) => padX + (i / (n - 1)) * (W - padX * 2);
  const y = (v: number) => padY + v * (H - padY * 2);
  const dLine = curve.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dArea = `${dLine} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="ps-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={dArea} fill="url(#ps-fill)" />
      <path d={dLine} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(curve[n - 1])} r={3} fill={color} />
    </svg>
  );
}
