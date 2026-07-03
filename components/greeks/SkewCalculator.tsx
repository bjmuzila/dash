"use client";

/* ────────────────────────────────────────────────────────────────────────────
 * Volatility Skew Calculator + If-This-Then-That matrix
 *
 *   skew = (OTM_Put_IV − OTM_Call_IV) / ATM_IV
 *
 * Positive skew (typically 10–30% for equities) = bearish fear (puts richer).
 * Use 25-delta or a fixed % OTM (±5–10% from spot) for consistency.
 *
 * Pure client component: three IV inputs (OTM put, OTM call, ATM) → live skew %
 * plus a highlighted regime band and an if-this-then-that lookup table.
 * ──────────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeInputStyle } from "@/components/shared/homeTheme";

// Skew regime bands (skew expressed as a percentage: 100 * (Pput−Pcall)/ATM).
interface Band {
  id: string;
  lo: number;              // inclusive lower bound (%)
  hi: number;              // exclusive upper bound (%)
  label: string;
  tone: "bear" | "neutral" | "bull" | "extreme";
  ifThis: string;
  thenThat: string;
}

const COLORS = {
  bear: "#ff5252",
  neutral: "#9fb3c8",
  bull: "#00e676",
  extreme: "#ff8c1a",
} as const;

// Ordered low→high. Bounds in percent.
const BANDS: Band[] = [
  {
    id: "inverted", lo: -Infinity, hi: 0, tone: "bull",
    label: "Inverted / Call Skew",
    ifThis: "Skew < 0% — OTM calls richer than OTM puts.",
    thenThat: "Upside/melt-up or squeeze demand (call chasing, commodities-like). Right-tail hedging or bullish speculation dominant. Favor call spreads over naked longs; watch for a fast vol-up move that flips skew back positive.",
  },
  {
    id: "flat", lo: 0, hi: 10, tone: "neutral",
    label: "Flat / Complacent",
    ifThis: "Skew 0–10% — unusually flat for equity index.",
    thenThat: "Low fear premium; puts cheap relative to ATM. Good backdrop to BUY downside protection / put spreads cheaply. Complacency risk — a shock can re-steepen skew violently.",
  },
  {
    id: "normal", lo: 10, hi: 30, tone: "neutral",
    label: "Normal Equity Skew",
    ifThis: "Skew 10–30% — the typical equity-index regime.",
    thenThat: "Balanced fear premium. No skew edge on its own — trade the underlying thesis. Put-selling / put-spread financing works; puts are moderately rich, so prefer spreads to naked long puts.",
  },
  {
    id: "steep", lo: 30, hi: 45, tone: "bear",
    label: "Steep / Elevated Fear",
    ifThis: "Skew 30–45% — puts materially bid.",
    thenThat: "Rising downside hedging demand — defensive positioning building. Favor put SPREADS or ratio structures (long put financed by richer further-OTM puts). Selling puts pays well but carries real tail risk; size down.",
  },
  {
    id: "extreme", lo: 45, hi: Infinity, tone: "extreme",
    label: "Extreme / Panic Skew",
    ifThis: "Skew > 45% — crash-fear pricing.",
    thenThat: "Capitulation-grade put demand; downside convexity very rich. Fade the fear: sell put spreads / put ratios, or harvest skew via risk reversals. Often near local BOTTOMS once spot stabilizes — but never sell naked into a falling tape.",
  },
];

function bandFor(skewPct: number): Band {
  return BANDS.find(b => skewPct >= b.lo && skewPct < b.hi) ?? BANDS[2];
}

function parseNum(s: string): number | null {
  if (s.trim() === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export default function SkewCalculator() {
  const [putIv, setPutIv] = useState("");   // OTM put IV, %
  const [callIv, setCallIv] = useState(""); // OTM call IV, %
  const [atmIv, setAtmIv] = useState("");   // ATM IV, %

  const p = parseNum(putIv);
  const c = parseNum(callIv);
  const a = parseNum(atmIv);

  const skewPct = useMemo(() => {
    if (p == null || c == null || a == null || a <= 0) return null;
    return ((p - c) / a) * 100;
  }, [p, c, a]);

  const spread = p != null && c != null ? p - c : null; // raw vol points
  const active = skewPct != null ? bandFor(skewPct) : null;

  const inputRow = (
    label: string, hint: string, val: string,
    set: (v: string) => void, accent: string,
  ) => (
    <div style={{ flex: "1 1 150px", minWidth: 140 }}>
      <div style={{ fontSize: 10, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ position: "relative" }}>
        <input
          type="number" inputMode="decimal" placeholder={hint} value={val}
          onChange={(e) => set(e.target.value)}
          style={{ ...homeInputStyle, width: "100%", paddingRight: 26, borderColor: `${accent}55`, fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700 }}
        />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#7e8ea0", fontWeight: 700 }}>%</span>
      </div>
    </div>
  );

  return (
    <section className="card-hover" style={{
      marginTop: 14, border: `1px solid ${HOME_THEME.border}`, borderRadius: 16, padding: 16,
      backdropFilter: "blur(16px)",
      background: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.12) 0%, transparent 60%), ${HOME_THEME.panelBg}`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, border: `1px solid ${LIGHT_BLUE}66`,
          display: "flex", alignItems: "center", justifyContent: "center", color: LIGHT_BLUE, fontWeight: 800, fontSize: 15,
        }}>◱</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>Vol Skew Calculator</div>
          <div style={{ fontSize: 10, color: LIGHT_BLUE, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>
            (OTM Put IV − OTM Call IV) / ATM IV
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {inputRow("OTM Put IV", "25Δ / −5-10%", putIv, setPutIv, COLORS.bear)}
        {inputRow("OTM Call IV", "25Δ / +5-10%", callIv, setCallIv, COLORS.bull)}
        {inputRow("ATM IV", "spot IV", atmIv, setAtmIv, LIGHT_BLUE)}

        {/* Result */}
        <div style={{
          flex: "1 1 160px", minWidth: 150, padding: "10px 14px", borderRadius: 12,
          border: `1px solid ${active ? COLORS[active.tone] : HOME_THEME.border}55`,
          background: active ? `${COLORS[active.tone]}12` : "rgba(0,0,0,0.25)",
        }}>
          <div style={{ fontSize: 10, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Skew</div>
          <div style={{ fontSize: 30, fontWeight: 900, fontFamily: "var(--font-mono)", color: active ? COLORS[active.tone] : "#9fb3c8", lineHeight: 1.1 }}>
            {skewPct != null ? `${skewPct >= 0 ? "+" : ""}${skewPct.toFixed(1)}%` : "--"}
          </div>
          <div style={{ fontSize: 11, color: "#c9d7db", fontWeight: 700, marginTop: 2 }}>
            {spread != null ? `${spread >= 0 ? "+" : ""}${spread.toFixed(2)} vol pts` : "enter three IVs"}
          </div>
        </div>
      </div>

      {/* Live interpretation */}
      {active && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 10,
          borderLeft: `3px solid ${COLORS[active.tone]}`, background: `${COLORS[active.tone]}0e`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: COLORS[active.tone], marginBottom: 3 }}>{active.label}</div>
          <div style={{ fontSize: 12, color: "#d7e6e8", lineHeight: 1.5 }}>{active.thenThat}</div>
        </div>
      )}

      {/* If-this-then-that matrix */}
      <div style={{ marginTop: 14, border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,1.1fr) minmax(150px,1.4fr) minmax(200px,2.4fr)", background: "rgba(255,255,255,.04)", borderBottom: `1px solid ${HOME_THEME.border}` }}>
          {["Skew band", "If this", "Then that"].map((h) => (
            <div key={h} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".08em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>
        {BANDS.map((b) => {
          const isActive = active?.id === b.id;
          return (
            <div key={b.id} style={{
              display: "grid", gridTemplateColumns: "minmax(120px,1.1fr) minmax(150px,1.4fr) minmax(200px,2.4fr)",
              borderBottom: `1px solid rgba(255,255,255,.05)`,
              borderLeft: `3px solid ${isActive ? COLORS[b.tone] : "transparent"}`,
              background: isActive ? `${COLORS[b.tone]}12` : "transparent",
            }}>
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: COLORS[b.tone] }}>{b.label}</div>
                <div style={{ fontSize: 10, color: "#7e8ea0", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {b.lo === -Infinity ? "< 0%" : b.hi === Infinity ? `> ${b.lo}%` : `${b.lo}–${b.hi}%`}
                </div>
              </div>
              <div style={{ padding: "10px 12px", fontSize: 11.5, color: "#c9d7db", lineHeight: 1.45 }}>{b.ifThis}</div>
              <div style={{ padding: "10px 12px", fontSize: 11.5, color: "#d7e6e8", lineHeight: 1.45 }}>{b.thenThat}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 10.5, color: "#7e8ea0", lineHeight: 1.5 }}>
        Convention: positive skew = puts richer = downside fear. Keep the put/call legs at a consistent moneyness
        (25-delta, or a fixed ±5-10% from spot) so readings are comparable across sessions.
      </div>
    </section>
  );
}
