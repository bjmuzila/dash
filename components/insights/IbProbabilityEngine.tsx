"use client";

/**
 * IB Probability Engine — live projection board.
 *
 * Recreates the 3-gauge Probability Engine (Bullish / Bearish / Rotation) plus
 * the 4-stage rule board (R1–R14) from the design mockup. The three gauges are
 * computed from the active rules via calculateComplexProbabilities:
 *   1) each ACTIVE rule adds (edge/100)*1.5 into its bucket
 *   2) environmental multipliers — IB width / volume / time of day
 *   3) normalize to 100, rotation = 100 - bull - bear
 *
 * Rule states are static placeholders that mirror the mockup so the layout can
 * be read on the live page. The R-ids map 1:1 to the app's buildRules() engine,
 * so this can later be wired to today's real IB state.
 */

import { HOME_THEME } from "@/components/shared/homeTheme";

type Status = "bull" | "bear" | "rot" | "off";

const C = {
  bg: "rgba(8,12,20,0.55)",
  panel: "rgba(14,22,38,0.55)",
  border: HOME_THEME.border,
  text: "#e8eef7",
  muted: "#8a97ab",
  cyan: "#2fb4d6",
  green: "#22c55e",
  red: "#f0506e",
  orange: "#fb8500",
  grey: "#5b6676",
};

const EDGECOL: Record<Status, string> = { bull: C.green, bear: C.red, rot: C.orange, off: C.grey };
const TAG: Record<Status, string> = { bull: "Bullish Edge", bear: "Bearish Edge", rot: "Rotational Risk", off: "Inactive" };

type Rule = { id: string; name: string; status: Status; edge: number; desc: string };
type Stage = { icon: string; title: string; rules: Rule[] };

const STAGES: Stage[] = [
  { icon: "🔒", title: "Stage 1: Opening Baseline Setup", rules: [
    { id: "R4",  name: "IB Width → Day Type",       status: "rot",  edge: 88, desc: "Wide range relative to average: Reversion & rotation favored." },
    { id: "R11", name: "Open Type + IB Width",       status: "rot",  edge: 90, desc: "Neutral-moderate width structure: Regular rotational limits expected." },
    { id: "R7",  name: "15m FVG inside IB",          status: "bull", edge: 68, desc: "Unfilled Bullish FVG inside range: Acts as magnetic target to the upside." },
    { id: "R2",  name: "Formation Order + Midpoint", status: "bull", edge: 74, desc: "Low formed first + trading above midpoint: Strong bullish advantage." },
  ]},
  { icon: "🔓", title: "Stage 2: Interior Range Dynamics", rules: [
    { id: "R1",  name: "Midpoint Close Bias",        status: "bull", edge: 65, desc: "Trading above Midpoint: Statistical edge favors testing High first." },
    { id: "R10", name: "Close Location (strong)",    status: "bull", edge: 76, desc: "Top 25% Squeeze: Closing near high bounds signals high probability breakout." },
    { id: "R12", name: "Inner ORB + Alignment",      status: "bull", edge: 75, desc: "Inside-Out Alignment: Localized 30m breakout aligns with macro trend bias." },
  ]},
  { icon: "🔓", title: "Stage 3: Breakout Validation & Traps", rules: [
    { id: "R5",  name: "Breakout Entry + Volume",    status: "off", edge: 78, desc: "Pending breakout force." },
    { id: "R6",  name: "Failed Breakout Fade",       status: "off", edge: 83, desc: "No failed boundary trap observed." },
    { id: "R13", name: "Time Filter",                status: "off", edge: 78, desc: "No breakout sequence timed." },
  ]},
  { icon: "🏁", title: "Stage 4: Continuation Targets & End-of-Day", rules: [
    { id: "R3",  name: "Single Break Continuation",  status: "off", edge: 76, desc: "Awaiting first clean break to track continuation." },
    { id: "R8",  name: "Retest Continuation",        status: "off", edge: 71, desc: "No breakout retest in progress." },
    { id: "R9",  name: "Extension Targets",          status: "off", edge: 69, desc: "No active extension leg to measure." },
    { id: "R14", name: "Contained Day",              status: "off", edge: 80, desc: "Not yet 2:00 PM ET — containment unconfirmed." },
  ]},
];

// live environment inputs (drive the multipliers)
const ENV = { ibWidth: "wide" as "wide" | "narrow" | "normal", volume: "normal" as "active" | "normal", time: "regular" as "late" | "regular" };

function calculateComplexProbabilities() {
  let bull = 0, bear = 0, rot = 0;
  STAGES.flatMap((s) => s.rules).forEach((r) => {
    if (r.status === "off") return;
    const pts = (r.edge / 100) * 1.5;
    if (r.status === "bull") bull += pts;
    else if (r.status === "bear") bear += pts;
    else if (r.status === "rot") rot += pts;
  });
  if (ENV.ibWidth === "wide") rot += 2.0;
  if (ENV.ibWidth === "narrow") { bull += 0.8; bear += 0.8; }
  if (ENV.volume === "active") { bull *= 1.3; bear *= 1.3; } else { rot *= 1.2; }
  if (ENV.time === "late") rot *= 1.5;
  const total = bull + bear + rot || 1;
  const bullPct = Math.round((bull / total) * 100);
  const bearPct = Math.round((bear / total) * 100);
  return { bull: bullPct, bear: bearPct, rot: 100 - bullPct - bearPct };
}

function Gauge({ pct, color, label }: { pct: number; color: string; label: string }) {
  const R = 50, CIRC = 2 * Math.PI * R, off = CIRC * (1 - pct / 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: 118, height: 118 }}>
        <svg width="118" height="118" viewBox="0 0 118 118" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="59" cy="59" r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="9" />
          <circle cx="59" cy="59" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={CIRC.toFixed(1)} strokeDashoffset={off.toFixed(1)} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: pct > 0 ? color : C.muted }}>{pct}%</div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted, textAlign: "center", lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: label }} />
    </div>
  );
}

function SegBar({ pct, status }: { pct: number; status: Status }) {
  const on = Math.round(pct / 10), col = EDGECOL[status];
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} style={{ flex: 1, height: 8, borderRadius: 2,
          background: i < on ? col : "rgba(255,255,255,.06)", opacity: i < on && status === "off" ? 0.5 : 1 }} />
      ))}
    </div>
  );
}

function RuleRow({ r }: { r: Rule }) {
  const col = EDGECOL[r.status];
  const dim = r.status === "off";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 200px", gap: 18, alignItems: "center",
      background: C.panel, border: `1px solid ${C.border}`, borderLeft: `4px solid ${col}`, borderRadius: 12,
      padding: "14px 16px", opacity: dim ? 0.62 : 1 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 800, fontFamily: "ui-monospace,Menlo,Consolas,monospace", color: C.muted,
            background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 6px" }}>{r.id}</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: col,
            border: `1px solid ${col}66`, background: `${col}14`, borderRadius: 5, padding: "2px 7px" }}>{TAG[r.status]}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.25 }}>{r.name}</div>
      </div>
      <div style={{ fontSize: 13, color: dim ? C.muted : "#cdd6e4", lineHeight: 1.5, display: "flex", gap: 9, alignItems: "flex-start" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flex: "none", background: col }} />
        <span>{r.desc}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted }}>Hist. Edge</span>
          <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: dim ? C.muted : col }}>{r.edge}%</span>
        </div>
        <SegBar pct={r.edge} status={r.status} />
      </div>
    </div>
  );
}

export function IbProbabilityEngine() {
  const p = calculateComplexProbabilities();
  const card: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 18, padding: "22px 22px 24px" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Probability Engine */}
      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: C.cyan }}>Probability Engine</span>
        </div>
        <p style={{ fontSize: 12.5, color: "#9a7fd0", margin: "4px 0 0" }}>Live mathematical projection of final intraday session behavior based on active indicators.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 22 }}>
          <Gauge pct={p.bull} color={C.green} label="Bullish<br/>Edge" />
          <Gauge pct={p.bear} color={C.red} label="Bearish<br/>Edge" />
          <Gauge pct={p.rot} color={C.orange} label="Rotation<br/>Risk" />
        </div>
      </section>

      {/* Stages */}
      {STAGES.map((s) => (
        <section key={s.title} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: C.cyan }}>{s.title}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
            {s.rules.map((r) => <RuleRow key={r.id} r={r} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

export default IbProbabilityEngine;
