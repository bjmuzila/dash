"use client";

/**
 * IB Probability Engine — live projection board.
 *
 * Three gauges (Bullish / Bearish / Rotation) + the 4-stage rule board (R1–R14),
 * driven by the app's real buildRules() engine. Each rule's Historical Edge is
 * its live conditional hit-rate; the gauges are computed by
 * calculateComplexProbabilities:
 *   1) each ACTIVE (in-play) rule adds (edge/100)*1.5 into its bucket (by side)
 *   2) environmental multipliers — IB width / volume / time of day
 *   3) normalize to 100, rotation = 100 - bull - bear
 *
 * Rule ids map 1:1 to buildRules(). Pending / not-in-play rules render as
 * INACTIVE (their "if it fires" edge is still shown but doesn't move the gauges).
 */

type Status = "bull" | "bear" | "rot" | "off";

export type EngineRule = {
  id: string;                                   // "1" … "14" (from buildRules)
  name: string;
  state: "in-play" | "pending" | "not-in-play";
  side: "H" | "L" | null;
  read: string;                                 // live description
  p: number | null;                             // historical edge %
};

export type EngineEnv = {
  ibWidth: "wide" | "narrow" | "normal";
  volume: "active" | "normal";
  time: "late" | "regular";
};

const C = {
  bg: "rgba(8,12,20,0.55)",
  panel: "rgba(14,22,38,0.55)",
  border: "rgba(255,255,255,0.10)",
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

// R-id → stage bucket (mirrors the mockup); ids not listed are ignored.
const STAGE_DEFS: { icon: string; title: string; ids: string[] }[] = [
  { icon: "🔒", title: "Stage 1: Opening Baseline Setup",        ids: ["4", "11", "7", "2"] },
  { icon: "🔓", title: "Stage 2: Interior Range Dynamics",        ids: ["1", "10", "12"] },
  { icon: "🔓", title: "Stage 3: Breakout Validation & Traps",    ids: ["5", "6", "13"] },
  { icon: "🏁", title: "Stage 4: Continuation Targets & End-of-Day", ids: ["3", "8", "9", "14"] },
];

type Row = { id: string; name: string; status: Status; edge: number | null; desc: string };

function toRow(r: EngineRule): Row {
  const status: Status =
    r.state !== "in-play" ? "off"
    : r.side === "H" ? "bull"
    : r.side === "L" ? "bear"
    : "rot";
  return { id: "R" + r.id, name: r.name, status, edge: r.p == null ? null : Math.round(r.p), desc: r.read };
}

/* ── Step 1–3 : calculateComplexProbabilities ─────────────────────────────── */
function calculateComplexProbabilities(rows: Row[], env: EngineEnv) {
  let bull = 0, bear = 0, rot = 0, active = 0;
  rows.forEach((r) => {
    if (r.status === "off" || r.edge == null) return;
    active++;
    const pts = (r.edge / 100) * 1.5;
    if (r.status === "bull") bull += pts;
    else if (r.status === "bear") bear += pts;
    else rot += pts;
  });
  if (!active) return { bull: 0, bear: 0, rot: 0 };
  if (env.ibWidth === "wide") rot += 2.0;
  if (env.ibWidth === "narrow") { bull += 0.8; bear += 0.8; }
  if (env.volume === "active") { bull *= 1.3; bear *= 1.3; } else { rot *= 1.2; }
  if (env.time === "late") rot *= 1.5;
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
            strokeDasharray={CIRC.toFixed(1)} strokeDashoffset={off.toFixed(1)} style={{ transition: "stroke-dashoffset .6s" }} />
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

function RuleRow({ r }: { r: Row }) {
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
          <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: dim || r.edge == null ? C.muted : col }}>{r.edge == null ? "—" : `${r.edge}%`}</span>
        </div>
        <SegBar pct={r.edge ?? 0} status={r.status} />
      </div>
    </div>
  );
}

export function IbProbabilityEngine({ rules, env }: { rules: EngineRule[]; env: EngineEnv }) {
  const byId = new Map(rules.map((r) => [r.id, toRow(r)]));
  const allRows = STAGE_DEFS.flatMap((s) => s.ids.map((id) => byId.get(id)).filter(Boolean) as Row[]);
  const p = calculateComplexProbabilities(allRows, env);
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
      {STAGE_DEFS.map((s) => {
        const rows = s.ids.map((id) => byId.get(id)).filter(Boolean) as Row[];
        if (!rows.length) return null;
        return (
          <section key={s.title} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: C.cyan }}>{s.title}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              {rows.map((r) => <RuleRow key={r.id} r={r} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default IbProbabilityEngine;
