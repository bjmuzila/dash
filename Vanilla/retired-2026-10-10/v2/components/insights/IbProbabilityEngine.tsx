"use client";

/**
 * IB Probability Engine — live projection board (dashboard theme).
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

import { HOME_THEME } from "@/components/shared/homeTheme";

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

// Positive/negative semantic colors — real green, true red (not pink).
const POS = "#1FD98A";
const NEG = "#FF3B3B";

// Dashboard theme tokens — flat surfaces, no glow.
const C = {
  text: HOME_THEME.text,
  muted: "rgba(255,255,255,0.55)",
  cyan: HOME_THEME.cyan,
  bull: POS,                  // any positive breakout chance → green
  bear: NEG,                  // true red
  rot: HOME_THEME.orange,
  grey: "#6B7686",
  border: HOME_THEME.border,
  cardBg: HOME_THEME.panelBg,
  rowBg: "rgba(255,255,255,0.03)",
  track: "rgba(255,255,255,0.07)",
};

// Hist. Edge bar gradient — colored by the rule's direction (bull green, bear red,
// rotation orange), so a bearish rule reads red even at a high hit rate.
function edgeGradient(color: string): string {
  return `linear-gradient(90deg, ${color}59, ${color})`;
}

const EDGECOL: Record<Status, string> = { bull: C.bull, bear: C.bear, rot: C.rot, off: C.grey };
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
          <circle cx="59" cy="59" r={R} fill="none" stroke={C.track} strokeWidth="9" />
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

function EdgeBar({ edge, color }: { edge: number | null; color: string }) {
  return (
    <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
      {edge != null && (
        <div style={{ width: `${edge}%`, height: "100%", background: edgeGradient(color), transition: "width .6s" }} />
      )}
    </div>
  );
}

function RuleRow({ r }: { r: Row }) {
  const col = EDGECOL[r.status];
  const dim = r.status === "off";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 200px", gap: 18, alignItems: "center",
      background: C.rowBg, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: "14px 16px", opacity: dim ? 0.62 : 1 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 800, fontFamily: "var(--font-mono)", color: C.muted,
            background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 6px" }}>{r.id}</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: col,
            border: `1px solid ${col}66`, background: `${col}14`, borderRadius: 5, padding: "2px 7px" }}>{TAG[r.status]}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.25 }}>{r.name}</div>
      </div>
      <div style={{ fontSize: 13, color: dim ? C.muted : "rgba(255,255,255,0.82)", lineHeight: 1.5, display: "flex", gap: 9, alignItems: "flex-start" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flex: "none", background: col }} />
        <span>{r.desc}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted }}>Hist. Edge</span>
          <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: r.edge == null ? C.muted : col }}>{r.edge == null ? "—" : `${r.edge}%`}</span>
        </div>
        <EdgeBar edge={r.edge} color={col} />
      </div>
    </div>
  );
}

export function IbProbabilityEngine({ rules, env, sym, closeRules, closeEnv, showLive = true, showStages = true }: { rules: EngineRule[]; env: EngineEnv; sym?: string; closeRules?: EngineRule[]; closeEnv?: EngineEnv; showLive?: boolean; showStages?: boolean }) {
  const byId = new Map(rules.map((r) => [r.id, toRow(r)]));
  const allRows = STAGE_DEFS.flatMap((s) => s.ids.map((id) => byId.get(id)).filter(Boolean) as Row[]);
  const p = calculateComplexProbabilities(allRows, env);
  // Optional frozen-at-10:30 snapshot — same math, rendered as a second gauge row.
  let pClose: ReturnType<typeof calculateComplexProbabilities> | null = null;
  if (closeRules && closeEnv) {
    const cById = new Map(closeRules.map((r) => [r.id, toRow(r)]));
    const cRows = STAGE_DEFS.flatMap((s) => s.ids.map((id) => cById.get(id)).filter(Boolean) as Row[]);
    pClose = calculateComplexProbabilities(cRows, closeEnv);
  }
  // Flat dashboard surface — no radial glow, no drop shadow.
  const card: React.CSSProperties = {
    background: C.cardBg,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: "20px 20px 22px",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Probability Engine */}
      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: C.cyan }}>Probability Engine</span>
          {sym && (
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: C.cyan,
              border: `1px solid ${C.cyan}66`, background: `${C.cyan}14`, borderRadius: 5, padding: "2px 8px" }}>{sym}</span>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: C.muted, margin: "4px 0 0" }}>Live mathematical projection of final intraday session behavior based on active indicators{sym ? ` — ${sym} futures` : ""}.</p>

        {pClose && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 8px" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: HOME_THEME.orange,
              border: `1px solid ${HOME_THEME.orange}66`, background: `${HOME_THEME.orange}14`, borderRadius: 5, padding: "2px 8px" }}>10:30 Close</span>
            <span style={{ fontSize: 11, color: C.muted }}>frozen at the IB close</span>
          </div>
        )}
        {pClose && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            <Gauge pct={pClose.bull} color={C.bull} label="Bullish<br/>Edge" />
            <Gauge pct={pClose.bear} color={C.bear} label="Bearish<br/>Edge" />
            <Gauge pct={pClose.rot} color={C.rot} label="Rotation<br/>Risk" />
          </div>
        )}

        {/* Live gauges — shown when explicitly enabled, or as a provisional read before the 10:30 snapshot exists. */}
        {(showLive || !pClose) && pClose && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "22px 0 8px" }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: POS,
              border: `1px solid ${POS}66`, background: `${POS}14`, borderRadius: 5, padding: "2px 8px" }}>Live</span>
            <span style={{ fontSize: 11, color: C.muted }}>updating now</span>
          </div>
        )}
        {(showLive || !pClose) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: pClose ? 0 : 22 }}>
            <Gauge pct={p.bull} color={C.bull} label="Bullish<br/>Edge" />
            <Gauge pct={p.bear} color={C.bear} label="Bearish<br/>Edge" />
            <Gauge pct={p.rot} color={C.rot} label="Rotation<br/>Risk" />
          </div>
        )}
      </section>

      {/* Stages */}
      {showStages && STAGE_DEFS.map((s) => {
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
