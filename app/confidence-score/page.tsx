"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import {
  HOME_THEME,
  homeContentStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
} from "@/components/shared/homeTheme";
import { ToggleTile, DockButton, DockCalendar } from "@/components/shared/DockToolbar";

interface ScoreFactors {
  proximity: number;
  gexMagnitude: number;
  gammaRegime: "positive" | "negative" | "flat";
  flipProximity: number;
  dexBias: number;
  timeWeight: number;
  gexRank: number;
  rejectionRate: number;
}
interface ScoreResult {
  hit: number;
  pivot: number;
  chop: number;
  break: number;
  netWallBias: number;
  openAtMVC: boolean;
  factors: ScoreFactors;
  historyWeight: number;
  sampleSize: number;
  notes: string[];
}
interface Analog {
  date: string;
  level: number;
  gexMag: number;
  outcome: "hit" | "pivot" | "chop" | "miss";
}
interface Thresholds {
  hitPts: number;
  pivotPts: number;
  chopBand: number;
  analogGexTol: number;
  analogMax: number;
}
interface DayOutcome {
  kind: "reversal" | "pinned" | "false-break" | "breakout" | "squeeze" | "cascade" | "chop" | "approaching" | "untouched";
  wall: "call" | "put" | "neutral";
  title: string;
  status: string;
  detail: string;
  forward: string;
  provisional: boolean;
  final: boolean;
  touched: boolean;
  outcome: "hit" | "pivot" | "chop" | "miss";
  maxAway: number;
  maxBand: number;
  overshoot: number;
  seriesSource?: "es5m" | "snapshots";
  basis?: number | null;
  bars?: number;
}
interface MvcSegment {
  strike: number;
  from: string;
  to: string;
  snaps: number;
  current: boolean;
  kind: DayOutcome["kind"];
  title: string;
  status: string;
  detail: string;
  forward: string;
  touched: boolean;
  outcome: "hit" | "pivot" | "chop" | "miss";
  maxAway: number;
  maxBand: number;
  overshoot: number;
  closestApproach: number | null;
  minToTouch: number | null;
  distAtStart: number | null;
  score: { hit: number; pivot: number; chop: number; break: number; netWallBias: number };
  gexRank: number;
  rejectionRate: number;
  gammaRegime: "positive" | "negative" | "flat";
  stats: {
    spxAtActivation: number | null;
    netGex: number;
    netDex: number;
    gexFlip: number | null;
    gexDominance: number;
  };
}
interface MvcSummary {
  distinctStrikes: number;
  changes: number;
  engaged: number;
}
interface ApiResp {
  date: string;
  requestedDate?: string;
  stale?: boolean;
  mvcTimestamp?: number | string | null;
  level: number;
  price: number;
  spx: number;
  emSize: number;
  netGex: number;
  netDex: number;
  gexFlip: number | null;
  gexMagnitude: number;
  gexRank: number;
  sessionProgress: number;
  score: ScoreResult;
  dayOutcome?: DayOutcome;
  mvcTimeline?: MvcSegment[];
  mvcSummary?: MvcSummary;
  history: { sampleSize: number; hitRate: number; pivotRate: number; chopRate: number } | null;
  analogs: Analog[];
  thresholds?: Thresholds;
  error?: string;
  detail?: string;
}

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 min — matches MVC snapshot cadence

function todayET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d });

// Per-metric color identity (refined): Hit=cyan, Pivot=purple, Chop=orange.
const METRIC = {
  hit: HOME_THEME.cyan,
  pivot: HOME_THEME.purple,
  chop: HOME_THEME.orange,
  break: HOME_THEME.red,
} as const;

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Day-outcome archetype → color + glyph. Reversals/squeezes = pivot purple,
// breakouts/cascades = directional (green/red), pins/chop = chop orange.
const SCENARIO: Record<DayOutcome["kind"], { color: string; icon: string }> = {
  reversal:    { color: METRIC.pivot,     icon: "⟲" },
  squeeze:     { color: HOME_THEME.green, icon: "⤴" },
  "false-break": { color: METRIC.pivot,   icon: "⤬" },
  breakout:    { color: HOME_THEME.green, icon: "⤒" },
  cascade:     { color: HOME_THEME.red,   icon: "⤓" },
  pinned:      { color: METRIC.chop,      icon: "⊙" },
  chop:        { color: METRIC.chop,      icon: "≈" },
  approaching: { color: METRIC.hit,       icon: "→" },
  untouched:   { color: HOME_THEME.muted, icon: "·" },
};

// Interaction verb per archetype — the plain-language "what price did to the
// level" tag shown on each timeline row (touched / rejected / broke / etc.).
const VERB: Record<DayOutcome["kind"], string> = {
  reversal:    "Rejected",
  squeeze:     "Rejected",
  "false-break": "Rejected",
  breakout:    "Broke",
  cascade:     "Broke",
  pinned:      "Consolidated",
  chop:        "Consolidated",
  approaching: "Approaching",
  untouched:   "Untouched",
};

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span title={text} style={{ borderBottom: `1px dotted ${rgba(HOME_THEME.text, 0.3)}`, cursor: "help" }}>
      {children}
    </span>
  );
}

function SectionTitle({ text, accent }: { text: string; accent: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: accent }}>
      <span style={{ width: 14, height: 2, borderRadius: 2, background: accent, boxShadow: `0 0 6px ${rgba(accent, 0.6)}` }} />
      {text}
    </span>
  );
}

function Gauge({ label, value, hint, tip, accent }: { label: string; value: number; hint: string; tip: string; accent: string }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - value / 100);
  const gid = `grad-${label}`;
  const hot = label === "Hit" && value >= 85; // pulse on a strong Hit signal
  const glow = hot ? 0.85 : 0.5;
  return (
    <div className="conf-hover" style={{
      ...homePanelStyle,
      padding: 20,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      flex: 1,
      minWidth: 180,
      borderTop: `2px solid ${rgba(accent, hot ? 0.9 : 0.55)}`,
      background: `radial-gradient(circle at 50% 0%, ${rgba(accent, hot ? 0.16 : 0.08)} 0%, transparent 60%), ${HOME_THEME.panelBg}`,
      animation: hot ? "confPulse 1.8s ease-in-out infinite" : undefined,
    }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: accent }}>
        <Tip text={tip}>{label}</Tip>
      </span>
      <div style={{ position: "relative", width: 130, height: 130 }}>
        <svg width="130" height="130" viewBox="0 0 130 130" style={{ transform: "rotate(-90deg)" }}>
          <defs>
            <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
              <stop offset="100%" stopColor={accent} stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle cx="65" cy="65" r={r} fill="none" stroke={`url(#${gid})`} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={off}
            style={{ transition: "stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)", filter: `drop-shadow(0 0 ${hot ? 9 : 5}px ${rgba(accent, glow)})` }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: accent, textShadow: `0 0 ${hot ? 26 : 18}px ${rgba(accent, hot ? 0.55 : 0.35)}` }}>{value}</span>
          <span style={{ fontSize: 10, color: HOME_THEME.text, opacity: 0.7 }}>%</span>
        </div>
      </div>
      <span style={{ fontSize: 10, color: HOME_THEME.text, opacity: 0.75, textAlign: "center", lineHeight: 1.4 }}>{hint}</span>
    </div>
  );
}

/** Net Wall Bias = pivot − break, shown as a centered signed meter
 *  (−100 break ⟵ 0 ⟶ +100 defend). Green right = wall defends, red left = break. */
function BiasMeter({ value, note, noteColor }: { value: number; note?: string; noteColor?: string }) {
  const v = Math.max(-100, Math.min(100, value));
  const defend = v >= 0;
  const col = Math.abs(v) < 12 ? METRIC.chop : defend ? HOME_THEME.green : HOME_THEME.red;
  const pct = Math.abs(v) / 2; // half-bar fill (0..50% of full width)
  const read =
    v >= 25 ? "Lean defense — favor holds / continuation if it holds"
    : v <= -25 ? "Respect the break — don't fight momentum through"
    : "Neutral — smaller size until a clear reaction at the level";
  return (
    <div className="conf-hover" style={{ ...homePanelStyle, padding: "14px 18px", display: "flex",
      flexDirection: "column", gap: 10, borderTop: `2px solid ${rgba(col, 0.6)}`,
      background: `radial-gradient(circle at ${defend ? "100%" : "0%"} 0%, ${rgba(col, 0.1)} 0%, transparent 60%), ${HOME_THEME.panelBg}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: col }}>
          <Tip text="Net Wall Bias = Pivot − Break. Positive = expect defense; negative = respect the break.">Net Wall Bias</Tip>
        </span>
        <span style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: col, textShadow: `0 0 16px ${rgba(col, 0.4)}` }}>
          {v >= 0 ? "+" : ""}{v}
        </span>
      </div>
      <div style={{ position: "relative", height: 12, background: "rgba(255,255,255,0.05)", borderRadius: 6 }}>
        <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 2, background: rgba(HOME_THEME.text, 0.3) }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 6,
          left: defend ? "50%" : `${50 - pct}%`, width: `${pct}%`,
          background: `linear-gradient(90deg, ${rgba(col, 0.45)}, ${col})`,
          boxShadow: `0 0 10px ${rgba(col, 0.5)}`, transition: "all .45s cubic-bezier(.4,0,.2,1)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: "monospace",
        textTransform: "uppercase", letterSpacing: ".06em", color: HOME_THEME.muted }}>
        <span style={{ color: rgba(HOME_THEME.red, 0.8) }}>← Break</span>
        <span style={{ color: rgba(HOME_THEME.green, 0.8) }}>Defend →</span>
      </div>
      <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.9, lineHeight: 1.45 }}>{read}</span>
      {note && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingTop: 8, marginTop: 2,
          borderTop: `1px solid ${HOME_THEME.border}` }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase",
            color: noteColor ?? HOME_THEME.muted, flexShrink: 0, marginTop: 2 }}>Bias</span>
          <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.9, lineHeight: 1.45 }}>{note}</span>
        </div>
      )}
    </div>
  );
}

function FactorBar({ label, value, tip, signed = false, accent = HOME_THEME.cyan, emphasize = false }: {
  label: string; value: number; tip: string; signed?: boolean; accent?: string; emphasize?: boolean;
}) {
  const pct = signed ? Math.abs(value) * 100 : value * 100;
  // Signed bars use a sharp red→green gradient anchored by sign + magnitude.
  const color = signed ? (value >= 0 ? HOME_THEME.green : HOME_THEME.red) : accent;
  const h = emphasize ? 12 : 8;
  const fill = signed
    ? `linear-gradient(90deg, ${value >= 0 ? rgba(HOME_THEME.red, 0.25) : HOME_THEME.red}, ${value >= 0 ? HOME_THEME.green : rgba(HOME_THEME.green, 0.25)})`
    : `linear-gradient(90deg, ${rgba(color, 0.45)}, ${color})`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 78, fontSize: 11, color: HOME_THEME.text, opacity: 0.85, flexShrink: 0 }}>
        <Tip text={tip}>{label}</Tip>
      </span>
      <div style={{ flex: 1, height: h, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden",
        boxShadow: emphasize ? `inset 0 0 0 1px ${rgba(accent, 0.4)}` : undefined }}>
        <div style={{
          width: `${Math.min(100, pct)}%`,
          height: "100%",
          background: fill,
          boxShadow: `0 0 ${emphasize ? 12 : 8}px ${rgba(color, emphasize ? 0.6 : 0.45)}`,
          transition: "width .45s cubic-bezier(.4,0,.2,1)",
        }} />
      </div>
      <span style={{ width: 48, textAlign: "right", fontSize: 11, fontFamily: "monospace", fontWeight: 700, color }}>
        {signed ? (value >= 0 ? "+" : "") : ""}{(value * 100).toFixed(0)}
      </span>
    </div>
  );
}

/** Hero MVC card — the one-glance trade read at the top of the Outcome box.
 *  REACH = probability price gets to the level (the Hit score). On a touch, the
 *  three outcomes (reject / chop / break) are renormalized to sum to 100% so they
 *  read as a true probability split — display-only, the engine scores stay raw. */
function MvcHero({
  level, spx, reach, pivot, chop, brk, wall, provisional, headline, metrics,
}: {
  level: number; spx: number | null; reach: number;
  pivot: number; chop: number; brk: number;
  wall: "call" | "put" | "neutral"; provisional: boolean;
  headline?: string;
  metrics?: { netGex: number; netDex: number; gexFlip: number | null; emSize: number; gexRank: number; sessionProgress: number };
}) {
  const dist = spx != null ? Math.round(Math.abs(spx - level)) : null;
  // pivot/chop/break already arrive as a conditional-on-hit split summing to 100
  // (renormalized in the engine). Use directly; re-derive chop as the remainder
  // only to absorb any upstream rounding so the bar always totals 100.
  const reject = pivot;
  const breakP = brk;
  const chopP = Math.max(0, 100 - reject - breakP);
  const lean = reject >= breakP;
  const leanColor = Math.abs(reject - breakP) < 12 ? METRIC.chop : lean ? HOME_THEME.green : HOME_THEME.red;
  const wallLabel = wall === "call" ? "Call Wall" : wall === "put" ? "Put Wall" : "Level";
  const reachColor = reach >= 70 ? METRIC.hit : reach >= 45 ? METRIC.chop : HOME_THEME.muted;

  // A horizontal reject|chop|break split bar.
  const Seg = ({ pct, color, label }: { pct: number; color: string; label: string }) =>
    pct <= 0 ? null : (
      <div title={`${label} ${pct}%`} style={{ width: `${pct}%`, background: `linear-gradient(180deg, ${rgba(color, 0.85)}, ${color})`,
        display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0 }}>
        {pct >= 12 && <span style={{ fontSize: 11, fontWeight: 800, color: "#0b0e14", fontFamily: "monospace" }}>{pct}%</span>}
      </div>
    );

  return (
    <div className="conf-hover" style={{ ...homePanelStyle, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16,
      borderTop: `3px solid ${rgba(leanColor, 0.7)}`,
      background: `radial-gradient(circle at 50% -10%, ${rgba(leanColor, 0.12)} 0%, transparent 55%), ${HOME_THEME.panelBg}` }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        {/* MVC level */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: HOME_THEME.muted }}>CB · {wallLabel}</span>
          <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, fontFamily: "monospace", color: HOME_THEME.text, textShadow: `0 0 24px ${rgba(leanColor, 0.3)}` }}>{fmt(level)}</span>
          <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.7, fontFamily: "monospace" }}>
            SPX {fmt(spx)}{dist != null && <> · <strong style={{ color: leanColor }}>{dist} pts</strong> away</>}
          </span>
        </div>

        {/* REACH */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: "auto", alignItems: "flex-end" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: reachColor }}>
            <Tip text="Reach = probability price gets to / interacts with the CB - Core Bullseye level today (the Hit score).">Reach</Tip>
          </span>
          <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: reachColor, textShadow: `0 0 22px ${rgba(reachColor, 0.4)}` }}>{reach}<span style={{ fontSize: 18, opacity: 0.7 }}>%</span></span>
          <span style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.7 }}>{reach >= 70 ? "likely to get there" : reach >= 45 ? "could get there" : "out of range for now"}</span>
        </div>
      </div>

      {/* On-touch outcome split */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: HOME_THEME.muted }}>
            If touched{provisional ? " · live" : ""}
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: leanColor }}>
            {lean ? `Rejects ${reject}%` : `Breaks ${breakP}%`}
            <span style={{ color: HOME_THEME.muted, fontWeight: 400 }}> {lean ? "— wall likely defends" : "— wall likely fails"}</span>
          </span>
        </div>
        <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", border: `1px solid ${HOME_THEME.border}` }}>
          <Seg pct={reject} color={METRIC.pivot} label="Reject" />
          <Seg pct={chopP} color={METRIC.chop} label="Chop" />
          <Seg pct={breakP} color={METRIC.break} label="Break" />
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 10, fontFamily: "monospace", color: HOME_THEME.muted, flexWrap: "wrap" }}>
          <span><span style={{ color: METRIC.pivot }}>■</span> Reject {reject}%</span>
          <span><span style={{ color: METRIC.chop }}>■</span> Chop {chopP}%</span>
          <span><span style={{ color: METRIC.break }}>■</span> Break {breakP}%</span>
          <span style={{ marginLeft: "auto", opacity: 0.7 }} title="CB - Core Bullseye study base rates: $SPX 0DTE, assumes intraday IV 16–45%.">
            study base: 55 / 26 / 17
          </span>
        </div>
      </div>

      {/* Headline read (top structural note) */}
      {headline && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: HOME_THEME.text, lineHeight: 1.5 }}>
          <span style={{ color: leanColor, marginTop: 1, flexShrink: 0 }}>▸</span>
          <span>{headline}</span>
        </div>
      )}

      {/* Mechanics strip — folded in from the old Read panel */}
      {metrics && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", paddingTop: 4, borderTop: `1px solid ${HOME_THEME.border}`,
          fontSize: 11, fontFamily: "monospace", color: HOME_THEME.text, opacity: 0.85 }}>
          <span>Net GEX {fmt(metrics.netGex, 0)}</span>
          <span>Net DEX {fmt(metrics.netDex, 0)}</span>
          <span>Flip {fmt(metrics.gexFlip)}</span>
          <span>EM ±{fmt(metrics.emSize)}</span>
          <span>GEX rank {Math.round((metrics.gexRank ?? 1) * 100)}%</span>
          <span>Session {Math.round(metrics.sessionProgress * 100)}%</span>
          <span style={{ marginLeft: "auto", opacity: 0.65 }} title="The study base rates assume intraday IV between 16% and 45%. Outside that band the probabilities may not hold.">
            ⚠ study valid for IV 16–45%
          </span>
        </div>
      )}
    </div>
  );
}

/** "So far" roll-up: which strike is the live MVC + how every prior anchor
 *  resolved (rejected / broke / consolidated / untouched). Shown at the top of
 *  the Outcome box. */
function SoFarRollup({ timeline }: { timeline: MvcSegment[] }) {
  const cur = timeline.find((g) => g.current) ?? timeline[timeline.length - 1];
  const c = { rejected: 0, broke: 0, consolidated: 0, abandoned: 0 };
  for (const g of timeline) {
    if (g.current) continue;
    if (g.kind === "reversal" || g.kind === "squeeze" || g.kind === "false-break") c.rejected++;
    else if (g.kind === "breakout" || g.kind === "cascade") c.broke++;
    else if (g.kind === "pinned" || g.kind === "chop") c.consolidated++;
    else if (!g.touched) c.abandoned++;
  }
  const curVerb = cur.touched && (cur.kind === "approaching" || cur.kind === "untouched")
    ? "touched" : VERB[cur.kind].toLowerCase();
  const chips: { label: string; n: number; color: string }[] = [
    { label: "rejected", n: c.rejected, color: METRIC.pivot },
    { label: "broke", n: c.broke, color: HOME_THEME.red },
    { label: "consolidated", n: c.consolidated, color: METRIC.chop },
    { label: "untouched", n: c.abandoned, color: HOME_THEME.muted },
  ].filter((x) => x.n > 0);
  return (
    <div style={{ ...homePanelStyle, padding: "10px 14px", display: "flex", alignItems: "center",
      gap: 12, flexWrap: "wrap", background: "rgba(255,255,255,0.02)", borderLeft: `2px solid ${rgba(SCENARIO[cur.kind].color, 0.5)}` }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: HOME_THEME.muted }}>So far</span>
      <span style={{ fontSize: 13, color: HOME_THEME.text, lineHeight: 1.5 }}>
        <strong style={{ color: SCENARIO[cur.kind].color }}>{fmt(cur.strike)}</strong> is the live CB - Core Bullseye
        {cur.distAtStart != null && <> — SPX <strong>{cur.distAtStart} pts</strong> away</>}, {curVerb}.
        {" "}{timeline.length} strike{timeline.length === 1 ? "" : "s"} have anchored today:
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chips.length === 0 ? (
          <span style={{ fontSize: 12, color: HOME_THEME.muted }}>none resolved yet</span>
        ) : chips.map((x) => (
          <span key={x.label} style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700,
            padding: "2px 8px", borderRadius: 4, color: x.color,
            background: rgba(x.color, 0.1), border: `1px solid ${rgba(x.color, 0.3)}` }}>
            {x.n} {x.label}
          </span>
        ))}
      </span>
    </div>
  );
}

/** One MVC strike in the timeline — compact row that expands to full stats.
 *  `nextSpx` is the SPX captured when the *next* strike became the MVC, which is
 *  exactly where price sat when this strike's reign ended (the handoff point). */
function TimelineRow({ seg, nextSpx }: { seg: MvcSegment; nextSpx: number | null }) {
  const [open, setOpen] = useState(false);
  const sc = SCENARIO[seg.kind];
  // Distance SPX was from this strike at the moment the magnet migrated away.
  const distAtEnd = nextSpx != null ? Math.round(Math.abs(nextSpx - seg.strike)) : null;
  const win = `${seg.from}${seg.to !== seg.from ? `–${seg.to}` : ""}`;
  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 10, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: HOME_THEME.text }}>{value}</span>
    </div>
  );
  return (
    <div style={{ borderRadius: 6, overflow: "hidden",
      background: seg.current ? rgba(sc.color, 0.08) : "rgba(255,255,255,0.02)",
      border: `1px solid ${seg.current ? rgba(sc.color, 0.3) : HOME_THEME.border}` }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, fontSize: 14,
          padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer", color: HOME_THEME.text, textAlign: "left" }}>
        <span style={{ color: HOME_THEME.muted, fontSize: 11, width: 12 }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: sc.color, fontSize: 17, width: 18, textAlign: "center" }}>{sc.icon}</span>
        <span style={{ fontFamily: "monospace", fontWeight: 700, width: 64 }}>{fmt(seg.strike)}</span>
        <span style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.6, width: 108 }}>{win}</span>
        <span style={{ color: sc.color, fontWeight: 700 }}>{seg.title}</span>
        {(() => {
          // Plain-language interaction verb. Touched-but-classified-approaching
          // (rare data edge) reads "Touched"; else the archetype verb.
          const verb = seg.touched && (seg.kind === "approaching" || seg.kind === "untouched") ? "Touched" : VERB[seg.kind];
          // Distance range while this strike was the active MVC: how far SPX was
          // when it became the magnet (start) → how far when the magnet migrated
          // away (end = next strike's activation SPX). The live strike hasn't
          // handed off yet, so it shows its closest approach so far instead.
          const start = seg.distAtStart;
          const end = seg.current ? seg.closestApproach : distAtEnd;
          const endWord = seg.current ? "closest so far" : "ended";
          const showRange = start != null && end != null && Math.abs(start - end) >= 1;
          const distLabel = start == null ? ""
            : showRange ? ` ${start}→${end}p`
            : ` ${start}p`;
          const distTip = start == null ? ""
            : showRange
              ? ` · SPX was ${start} pts away when this became the MVC and ${endWord} ${end} pts away`
              : ` · SPX held ${start} pts away the whole time this was the MVC`;
          return (
            <span title={`Level ${verb.toLowerCase()}${distTip}`}
              style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 800, letterSpacing: ".04em",
                textTransform: "uppercase", padding: "2px 7px", borderRadius: 4,
                color: sc.color, background: rgba(sc.color, 0.1), border: `1px solid ${rgba(sc.color, 0.3)}` }}>
              {verb}{distLabel}
            </span>
          );
        })()}
        {(() => {
          // SPX price + distance at each end of this strike's active reign:
          //   start = SPX when it became the MVC, end = SPX at the handoff.
          const startPx = seg.stats.spxAtActivation;
          const endPx = seg.current ? null : nextSpx;
          if (startPx == null) return null;
          const part = (px: number, dist: number | null) =>
            `${fmt(px)}${dist != null ? ` (${dist}p)` : ""}`;
          const text = endPx != null
            ? `${part(startPx, seg.distAtStart)} → ${part(endPx, distAtEnd)}`
            : part(startPx, seg.distAtStart);
          return (
            <span title="SPX price (distance from strike): start of reign → handoff to next CB - Core Bullseye"
              style={{ fontFamily: "monospace", fontSize: 11, color: HOME_THEME.text, whiteSpace: "nowrap" }}>
              {text}
            </span>
          );
        })()}
        {!seg.current && !seg.touched && (
          <span title="This CB - Core Bullseye strike was never touched before the magnet migrated to a new strike"
            style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 800, letterSpacing: ".04em",
              textTransform: "uppercase", padding: "2px 7px", borderRadius: 4,
              color: HOME_THEME.muted, background: rgba(HOME_THEME.muted, 0.12), border: `1px dashed ${rgba(HOME_THEME.muted, 0.4)}` }}>
            → new CB
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: METRIC.hit }}>{seg.score.hit}</span>
          <span style={{ color: METRIC.pivot }}>{seg.score.pivot}</span>
          <span style={{ color: METRIC.chop }}>{seg.score.chop}</span>
          <span style={{ color: METRIC.break }}>{seg.score.break}</span>
          {(() => {
            const b = seg.score.netWallBias;
            const c = Math.abs(b) < 12 ? METRIC.chop : b >= 0 ? HOME_THEME.green : HOME_THEME.red;
            return (
              <span title={`Net Wall Bias ${b >= 0 ? "+" : ""}${b} (pivot − break)`}
                style={{ color: c, fontSize: 11, padding: "1px 6px", borderRadius: 4,
                  background: rgba(c, 0.1), border: `1px solid ${rgba(c, 0.3)}` }}>
                {b >= 0 ? "+" : ""}{b}
              </span>
            );
          })()}
          <span style={{ color: HOME_THEME.muted, opacity: 0.7, fontWeight: 400 }}>×{seg.snaps}{seg.current ? "·now" : ""}</span>
        </span>
      </button>
      {open && (
        <div style={{ padding: "4px 14px 14px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.55 }}>{seg.detail}</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: 1.55,
            padding: "10px 12px", borderRadius: 6, background: rgba(sc.color, 0.06), border: `1px solid ${rgba(sc.color, 0.2)}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: sc.color, flexShrink: 0, marginTop: 3 }}>Next</span>
            <span>{seg.forward}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(86px,1fr))", gap: 10 }}>
            <Stat label="Score H/P/C/B" value={`${seg.score.hit}/${seg.score.pivot}/${seg.score.chop}/${seg.score.break}`} />
            <Stat label="Wall bias" value={`${seg.score.netWallBias >= 0 ? "+" : ""}${seg.score.netWallBias}`} />
            <Stat label="GEX rank" value={`${seg.gexRank}%`} />
            <Stat label="Rejection" value={`${seg.rejectionRate}%`} />
            <Stat label="Closest" value={seg.closestApproach != null ? `${seg.closestApproach} pts` : "—"} />
            <Stat label="Time to touch" value={seg.minToTouch != null ? `${seg.minToTouch} min` : "—"} />
            <Stat label="Dist @ start" value={seg.distAtStart != null ? `${seg.distAtStart} pts` : "—"} />
            {seg.touched && <Stat label="Reversal" value={`${seg.maxAway} pts`} />}
            {seg.touched && <Stat label="Band" value={`±${seg.maxBand} pts`} />}
            <Stat label="SPX @ activ." value={seg.stats.spxAtActivation != null ? fmt(seg.stats.spxAtActivation) : "—"} />
            <Stat label="GEX dom." value={`${seg.stats.gexDominance}%`} />
            <Stat label="Net GEX" value={fmt(seg.stats.netGex, 0)} />
            <Stat label="Net DEX" value={fmt(seg.stats.netDex, 0)} />
            <Stat label="Flip" value={seg.stats.gexFlip != null ? fmt(seg.stats.gexFlip) : "—"} />
            <Stat label="Regime" value={seg.gammaRegime} />
          </div>
        </div>
      )}
    </div>
  );
}

const GAUGE_TIP = {
  Hit: "Hit (Reach) = probability price gets to / interacts with the CB - Core Bullseye level today. Stage 1 — stands alone.",
  Pivot: "Pivot = GIVEN a touch, probability the level rejects price (reversal / defended wall). Conditional — Pivot + Chop + Break sum to 100%.",
  Chop: "Chop = GIVEN a touch, probability of range-bound / sticky action at the level. Conditional — Pivot + Chop + Break sum to 100%.",
  Break: "Break = GIVEN a touch, probability price slices THROUGH instead of holding. Conditional — Pivot + Chop + Break sum to 100%. Highest in negative-gamma at a dominant level.",
};
const FACTOR_TIP = {
  proximity: "Proximity: how close price is to the CB - Core Bullseye level, scaled by the Estimated Move. On the level = 100.",
  gexMagnitude: "GEX dominance: how concentrated the day's gamma is at this CB - Core Bullseye level. 100 = the dominant peak (strong magnet).",
  gexRank: "GEX rank: where this level ranks among today's CB - Core Bullseye strikes. 100 = the day's #1 magnet, 80 = 2nd, 60 = 3rd… Discounts strong-but-secondary walls.",
  rejectionRate: "Rejection rate: share of prior same-cluster touches that REVERSED price (defended) vs broke through. History of real rejections, time-decayed. Boosts Pivot, lowers Break.",
  flipProximity: "Flip proximity: how close price sits to the gamma flip — the volatility pivot zone.",
  dexBias: "DEX bias: signed directional pull from net delta exposure. Green = upward pull, red = downward.",
  timeWeight: "Time weight: a strong level acts more like a magnet earlier in the session; decays toward the close.",
};

/** One-line actionable read derived from the live factors + regime. */
function biasLine(s: ScoreResult): { text: string; color: string } {
  const f = s.factors;
  const dominant = f.gexMagnitude >= 0.4;
  if (f.gammaRegime === "positive" && dominant)
    return { text: "Strong magnet → watch for interaction & chop (dealers dampen moves in positive gamma).", color: METRIC.chop };
  if (f.gammaRegime === "negative" && dominant)
    return { text: "Dominant level in negative gamma → moves accelerate; expect breakthrough over clean pinning.", color: HOME_THEME.red };
  // Stage-2 lean: compare the conditional on-touch outcomes against each other
  // (they share the same 100% scale). Reach (s.hit) is a separate stage.
  if (s.pivot >= s.chop && s.pivot >= s.break)
    return { text: `If touched, reversal-leaning (${s.pivot}%) → wall likely rejects price; watch for a pivot.`, color: METRIC.pivot };
  if (s.break >= s.chop && s.break >= s.pivot)
    return { text: `If touched, break-leaning (${s.break}%) → wall likely fails; respect the move through.`, color: HOME_THEME.red };
  return { text: `If touched, range-bound (${s.chop}%) → sticky action likely around the level.`, color: METRIC.chop };
}

// ── Calibration (how accurate is the score, measured against history) ─────────
interface RelRow { bucket: string; n: number; predicted: number; actual: number }
interface RelTable { rows: RelRow[]; sample: number; brier: number | null }
interface CalibResp {
  gradedDays: number; touchedDays: number;
  reach: RelTable; reject: RelTable; break: RelTable;
  netWallBias: { sample: number; accuracy: number | null };
  heldRule: string; note: string; error?: string; detail?: string;
}

/** Verdict from a Brier score: <0.18 strong, <0.25 beats coin flip, else weak. */
function brierVerdict(b: number | null): { text: string; color: string } {
  if (b == null) return { text: "no data", color: HOME_THEME.muted };
  if (b < 0.18) return { text: "well-calibrated", color: HOME_THEME.green };
  if (b < 0.25) return { text: "beats a coin flip", color: METRIC.chop };
  return { text: "weak / uncalibrated", color: HOME_THEME.red };
}

function ReliabilityBlock({ title, accent, table }: { title: string; accent: string; table: RelTable }) {
  const v = brierVerdict(table.brier);
  return (
    <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: accent }}>{title}</span>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: v.color }}>
          Brier {table.brier ?? "—"} · {v.text}
        </span>
      </div>
      {table.rows.length === 0 ? (
        <span style={{ fontSize: 11, color: HOME_THEME.muted }}>No graded samples yet.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {table.rows.map((r) => {
            // Calibration error = |predicted − actual|. Small = trustworthy.
            const err = Math.abs(r.predicted - r.actual);
            const errColor = err <= 10 ? HOME_THEME.green : err <= 20 ? METRIC.chop : HOME_THEME.red;
            return (
              <div key={r.bucket} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "monospace" }}>
                <span style={{ width: 64, color: HOME_THEME.muted }}>{r.bucket}</span>
                <div style={{ flex: 1, height: 14, position: "relative", background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>
                  {/* predicted marker */}
                  <div title={`predicted ${r.predicted}%`} style={{ position: "absolute", top: -2, bottom: -2, left: `calc(${r.predicted}% - 1px)`, width: 2, background: HOME_THEME.muted }} />
                  {/* actual fill */}
                  <div title={`actual ${r.actual}%`} style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${r.actual}%`, background: rgba(accent, 0.55), borderRadius: 3 }} />
                </div>
                <span style={{ width: 92, textAlign: "right", color: errColor }}>
                  {r.predicted}→{r.actual}% <span style={{ color: HOME_THEME.muted }}>·n{r.n}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalibrationPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CalibResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/confidence/calibration${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const json: CalibResp = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open && !data) void load(false); }, [open, data, load]);

  return (
    <div style={{ ...homePanelStyle, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setOpen((v) => !v)}
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0,
            fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: HOME_THEME.purple,
            display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>{open ? "▾" : "▸"}</span> Calibration · How accurate is this?
        </button>
        {open && (
          <button onClick={() => void load(true)} disabled={loading} style={{ ...homeSecondaryButtonStyle, fontSize: 10, padding: "3px 10px" }}>
            {loading ? "Grading…" : "Re-grade history"}
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {err ? (
            <span style={{ fontSize: 12, color: HOME_THEME.red }}>{err}</span>
          ) : !data ? (
            <span style={{ fontSize: 12, color: HOME_THEME.muted }}>{loading ? "Loading…" : "—"}</span>
          ) : data.gradedDays === 0 ? (
            <span style={{ fontSize: 12, color: HOME_THEME.text }}>
              No graded history yet. Click <strong>Re-grade history</strong> to score &amp; grade past CB - Core Bullseye days.
            </span>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, fontFamily: "monospace", color: HOME_THEME.text, opacity: 0.85 }}>
                <span>{data.gradedDays} graded days</span>
                <span>{data.touchedDays} reached the level</span>
                {data.netWallBias.accuracy != null && (
                  <span>Net Wall Bias direction: <strong style={{ color: data.netWallBias.accuracy >= 55 ? HOME_THEME.green : HOME_THEME.red }}>{data.netWallBias.accuracy}%</strong> right (n{data.netWallBias.sample})</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <ReliabilityBlock title="Reach (touch)" accent={METRIC.hit} table={data.reach} />
                <ReliabilityBlock title="Reject | touched" accent={METRIC.pivot} table={data.reject} />
                <ReliabilityBlock title="Break | touched" accent={METRIC.break} table={data.break} />
              </div>
              <div style={{ fontSize: 11, color: HOME_THEME.muted, lineHeight: 1.5 }}>
                Bars = actual outcome rate; the vertical tick = what the score predicted for that bucket. Aligned = trustworthy.
                {" "}{data.note} <span style={{ opacity: 0.7 }}>({data.heldRule})</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConfidenceScorePage() {
  const [date, setDate] = useState(todayET());
  const [opex, setOpex] = useState(false);
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [showTuning, setShowTuning] = useState(false);
  const prevHit = useRef<number | null>(null);
  const [shifted, setShifted] = useState(false);

  const load = useCallback(async (d: string, isOpex: boolean, throwOnError = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: d });
      if (isOpex) params.set("opex", "1");
      const res = await fetch(`/api/confidence?${params.toString()}`, { cache: "no-store" });
      const json: ApiResp = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      // Flag a significant shift in the Hit score (>= 10 pts) since last load.
      if (prevHit.current != null && Math.abs(json.score.hit - prevHit.current) >= 10) {
        setShifted(true);
        setTimeout(() => setShifted(false), 6000);
      }
      prevHit.current = json.score.hit;
      setData(json);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(String(e));
      setData(null);
      if (throwOnError) throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const { trigger: refreshTrigger, label: refreshLabel, style: refreshStyle } =
    useRefreshButton(useCallback(async () => { await load(date, opex, true); }, [load, date, opex]));

  useEffect(() => {
    void load(date, opex);
  }, [date, opex, load]);

  // Always-live: poll the current day on a fixed interval. Historical dates are
  // static, so only today is polled. The MVC timeline carries intraday history.
  const isToday = date === todayET();
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => void load(date, opex), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [isToday, date, opex, load]);

  const s = data?.score;
  const bias = s ? biasLine(s) : null;

  return (
    <div style={homeShellStyle}>
      <style>{`
        @keyframes confPulse{0%,100%{box-shadow:0 0 0 0 ${rgba(METRIC.hit, 0.0)}}50%{box-shadow:0 0 22px 2px ${rgba(METRIC.hit, 0.28)}}}
        .conf-hover{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;}
        .conf-hover:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.35);border-color:${rgba(HOME_THEME.cyan, 0.35)};}
      `}</style>
      <div style={homeHeaderStyle}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>Confidence Score</span>
          {/* Live indicator — live polling on today, static for past dates */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: HOME_THEME.text, opacity: 0.85 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%",
              background: isToday ? HOME_THEME.green : HOME_THEME.muted,
              boxShadow: isToday ? `0 0 8px ${rgba(HOME_THEME.green, 0.8)}` : "none",
              animation: isToday ? "confPulse 1.6s ease-in-out infinite" : undefined }} />
            {isToday ? "LIVE" : "HISTORY"}
            {updatedAt && <span style={{ opacity: 0.6, fontFamily: "monospace" }}>· {updatedAt.toLocaleTimeString("en-US", { hour12: false })}</span>}
          </span>
          <span className="text-xs font-mono" style={{ color: HOME_THEME.text }}>
            {loading ? "Computing…" : data ? `CB ${fmt(data.level)} · SPX ${fmt(data.spx)}` : ""}
          </span>
          {data?.mvcTimestamp != null && (
            <span style={{ opacity: 0.6, fontSize: 10, fontFamily: "monospace" }}
              title="When the latest CB - Core Bullseye snapshot was captured">
              CB found {new Date(typeof data.mvcTimestamp === "string" ? Number(data.mvcTimestamp) : data.mvcTimestamp)
                .toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} ET
            </span>
          )}
          {data?.stale && (
            <span style={{ fontSize: 10, fontWeight: 700, color: HOME_THEME.orange,
              border: `1px solid ${rgba(HOME_THEME.orange, 0.5)}`, borderRadius: 4, padding: "1px 6px" }}
              title={`No snapshot for ${data.requestedDate}; showing last session with data (${data.date}).`}>
              STALE · {data.date}
            </span>
          )}
          <DockCalendar value={date} onChange={setDate} />
          <DockButton onClick={() => setDate(todayET())} title="Jump to today">Today</DockButton>
          <ToggleTile label="OPEX" on={opex} onClick={() => setOpex((v) => !v)} />
        </div>
        <DockButton onClick={refreshTrigger} title="Refresh" style={{ color: refreshStyle.color as string }}>{refreshLabel}</DockButton>
      </div>

      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        {shifted && (
          <div style={{ ...homePanelStyle, padding: "10px 16px", borderLeft: `3px solid ${HOME_THEME.cyan}`,
            color: HOME_THEME.cyan, fontSize: 12, fontWeight: 700, letterSpacing: ".04em" }}>
            ⚡ Score shifted significantly since last refresh.
          </div>
        )}
        {error ? (
          <div style={{ ...homePanelStyle, padding: 24, color: HOME_THEME.red, fontSize: 13 }}>{error}</div>
        ) : !data || !s ? (
          <div style={{ ...homePanelStyle, padding: 24, color: HOME_THEME.text, fontSize: 13 }}>
            {loading ? "Computing…" : "No data for this date."}
          </div>
        ) : (
          <>
            {/* Stage 1: does price REACH the level? Stands alone. */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 0 auto" }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: METRIC.hit }}>Stage 1 · Reach</span>
                <div style={{ display: "flex", gap: 16, flex: 1 }}>
                  <Gauge label="Hit" value={s.hit} hint="Probability price gets to the level" tip={GAUGE_TIP.Hit} accent={METRIC.hit} />
                </div>
              </div>
              {/* Stage 2: GIVEN a touch, exactly one happens → these sum to 100%. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 300 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: HOME_THEME.muted }}>
                  Stage 2 · If touched <span style={{ opacity: 0.6 }}>(sums to 100%)</span>
                </span>
                <div style={{ display: "flex", gap: 16, flex: 1 }}>
                  <Gauge label="Pivot" value={s.pivot} hint="Rejects / reverses off it" tip={GAUGE_TIP.Pivot} accent={METRIC.pivot} />
                  <Gauge label="Chop" value={s.chop} hint="Range-bound / sticky on it" tip={GAUGE_TIP.Chop} accent={METRIC.chop} />
                  <Gauge label="Break" value={s.break} hint="Slices through / fails to hold" tip={GAUGE_TIP.Break} accent={METRIC.break} />
                </div>
              </div>
            </div>

            {/* Net Wall Bias meter + structural bias read — one decision block */}
            <BiasMeter value={s.netWallBias} note={bias?.text} noteColor={bias?.color} />

            {/* 84% open-at-MVC alert — high-priority setup callout */}
            {s.openAtMVC && (
              <div style={{ ...homePanelStyle, padding: "12px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                borderLeft: `3px solid ${HOME_THEME.green}`,
                background: `radial-gradient(circle at 0% 0%, ${rgba(HOME_THEME.green, 0.12)} 0%, transparent 55%), ${HOME_THEME.panelBg}` }}>
                <span style={{ fontSize: 22, color: HOME_THEME.green }}>⤞</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.green }}>Opened AT the CB - Core Bullseye — 85% pivot setup</span>
                  <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.85 }}>
                    Study: price pivots within the first 15 min and closes the overnight gap ~85% of the time.
                  </span>
                </div>
              </div>
            )}

            {/* Live Structure — compact factor grid + regime/history badges */}
            <div className="conf-hover" style={{ ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 12, borderLeft: `2px solid ${rgba(HOME_THEME.cyan, 0.4)}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <SectionTitle text="Live Structure" accent={HOME_THEME.cyan} />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                    color: s.factors.gammaRegime === "positive" ? HOME_THEME.green : s.factors.gammaRegime === "negative" ? HOME_THEME.red : HOME_THEME.text,
                    background: "rgba(255,255,255,0.05)", border: `1px solid ${rgba(s.factors.gammaRegime === "positive" ? HOME_THEME.green : s.factors.gammaRegime === "negative" ? HOME_THEME.red : HOME_THEME.muted, 0.3)}` }}>
                    {s.factors.gammaRegime} gamma
                  </span>
                  <span title={s.sampleSize > 0
                    ? `Score blends ${Math.round(s.historyWeight * 100)}% historical from ${s.sampleSize} analog day${s.sampleSize === 1 ? "" : "s"}.`
                    : "No analog history yet — live-structure prior only."}
                    style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                    color: s.sampleSize > 0 ? HOME_THEME.purple : HOME_THEME.muted, background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${rgba(s.sampleSize > 0 ? HOME_THEME.purple : HOME_THEME.muted, 0.3)}` }}>
                    {s.sampleSize > 0 ? `${Math.round(s.historyWeight * 100)}% hist · ${s.sampleSize}` : "live only"}
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", columnGap: 20, rowGap: 8 }}>
                <FactorBar label="Proximity" value={s.factors.proximity} tip={FACTOR_TIP.proximity} accent={METRIC.hit} />
                <FactorBar label="GEX dom." value={s.factors.gexMagnitude} tip={FACTOR_TIP.gexMagnitude} accent={METRIC.hit} emphasize={s.factors.gexMagnitude >= 0.9} />
                <FactorBar label="GEX rank" value={s.factors.gexRank} tip={FACTOR_TIP.gexRank} accent={METRIC.hit} emphasize={s.factors.gexRank >= 1} />
                <FactorBar label="Rejection" value={s.factors.rejectionRate} tip={FACTOR_TIP.rejectionRate} accent={METRIC.pivot} emphasize={s.factors.rejectionRate >= 0.6} />
                <FactorBar label="Flip prox." value={s.factors.flipProximity} tip={FACTOR_TIP.flipProximity} accent={METRIC.pivot} />
                <FactorBar label="DEX bias" value={s.factors.dexBias} tip={FACTOR_TIP.dexBias} signed />
                <FactorBar label="Time wt." value={s.factors.timeWeight} tip={FACTOR_TIP.timeWeight} accent={METRIC.chop} />
              </div>
            </div>

            {/* Day outcome — MV strike result + GEX archetype (provisional → final) */}
            {data.dayOutcome && (() => {
              const o = data.dayOutcome;
              const sc = SCENARIO[o.kind];
              return (
                <div className="conf-hover" style={{ ...homePanelStyle, padding: 20, display: "flex", flexDirection: "column", gap: 14,
                  borderLeft: `2px solid ${rgba(sc.color, 0.55)}`,
                  background: `radial-gradient(circle at 0% 0%, ${rgba(sc.color, 0.08)} 0%, transparent 55%), ${HOME_THEME.panelBg}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <SectionTitle text="Outcome" accent={sc.color} />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800,
                      letterSpacing: ".1em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4,
                      color: o.final ? HOME_THEME.green : HOME_THEME.orange,
                      background: rgba(o.final ? HOME_THEME.green : HOME_THEME.orange, 0.1),
                      border: `1px solid ${rgba(o.final ? HOME_THEME.green : HOME_THEME.orange, 0.35)}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%",
                        background: o.final ? HOME_THEME.green : HOME_THEME.orange,
                        animation: o.final ? undefined : "confPulse 1.6s ease-in-out infinite" }} />
                      {o.final ? "Final" : "Live · Provisional"}
                    </span>
                  </div>

                  {/* Hero read: MVC level + REACH % + on-touch reject/break split */}
                  <MvcHero
                    level={data.level}
                    spx={data.spx}
                    reach={s.hit}
                    pivot={s.pivot}
                    chop={s.chop}
                    brk={s.break}
                    wall={o.wall}
                    provisional={!o.final}
                    headline={s.notes[0]}
                    metrics={{
                      netGex: data.netGex, netDex: data.netDex, gexFlip: data.gexFlip,
                      emSize: data.emSize, gexRank: data.gexRank ?? 1, sessionProgress: data.sessionProgress,
                    }}
                  />

                  {/* So-far roll-up: live MVC + how prior anchors resolved */}
                  {data.mvcTimeline && data.mvcTimeline.length > 0 && (
                    <SoFarRollup timeline={data.mvcTimeline} />
                  )}

                  {/* Archetype headline — icon + name + status (level/wall live in the hero) */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 28, lineHeight: 1, color: sc.color, textShadow: `0 0 16px ${rgba(sc.color, 0.4)}` }}>{sc.icon}</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: sc.color }}>{o.title}</span>
                    <span style={{ fontSize: 13, color: o.touched ? sc.color : HOME_THEME.muted, fontWeight: 700 }}>{o.status}</span>
                  </div>

                  {/* What happened */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 15, color: HOME_THEME.text, lineHeight: 1.55 }}>
                    <span style={{ color: sc.color, marginTop: 2, flexShrink: 0 }}>▸</span>
                    <span>{o.detail}</span>
                  </div>

                  {/* If/then forward read */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, lineHeight: 1.55,
                    padding: "12px 14px", borderRadius: 8,
                    background: rgba(sc.color, 0.06), border: `1px solid ${rgba(sc.color, 0.22)}` }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: sc.color, flexShrink: 0, marginTop: 3 }}>Next</span>
                    <span style={{ color: HOME_THEME.text }}>{o.forward}</span>
                  </div>

                  {/* MVC strike timeline — each distinct strike = a fresh MVC with
                      its own confidence score + outcome (expand a row for stats) */}
                  {data.mvcTimeline && data.mvcTimeline.length > 1 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: HOME_THEME.muted }}>
                          CB Timeline
                        </span>
                        {data.mvcSummary && (
                          <span style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.7 }}>
                            {data.mvcSummary.distinctStrikes} strikes · {data.mvcSummary.changes} change{data.mvcSummary.changes === 1 ? "" : "s"} · {data.mvcSummary.engaged} engaged
                          </span>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "monospace", opacity: 0.6, display: "flex", gap: 6 }}>
                          <span style={{ color: METRIC.hit }}>Hit</span>
                          <span style={{ color: METRIC.pivot }}>Pivot</span>
                          <span style={{ color: METRIC.chop }}>Chop</span>
                          <span style={{ color: METRIC.break }}>Break</span>
                          <span style={{ color: HOME_THEME.green }}>Bias</span>
                        </span>
                      </div>

                      {/* Newest (live) at top → oldest at bottom. nextSpx still
                          references the chronologically-next strike (the handoff). */}
                      {data.mvcTimeline.map((seg, i) => ({ seg, i })).reverse().map(({ seg, i }) => (
                        <TimelineRow key={i} seg={seg}
                          nextSpx={data.mvcTimeline![i + 1]?.stats.spxAtActivation ?? null} />
                      ))}
                    </div>
                  )}

                  {/* Data-source provenance (mechanics now live in the timeline rows) */}
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: HOME_THEME.text, fontFamily: "monospace", opacity: 0.85 }}>
                    <span title={o.seriesSource === "es5m"
                      ? `True 5-min SPX reconstructed from ES candles · basis ${o.basis ?? "—"} · ${o.bars ?? "?"} bars`
                      : `30-min MVC snapshots (no ES candles for this date) · ${o.bars ?? "?"} pts`}
                      style={{ marginLeft: "auto", fontFamily: "inherit", fontSize: 9, fontWeight: 800,
                        letterSpacing: ".06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4,
                        color: o.seriesSource === "es5m" ? METRIC.hit : HOME_THEME.muted,
                        background: rgba(o.seriesSource === "es5m" ? METRIC.hit : HOME_THEME.muted, 0.1),
                        border: `1px solid ${rgba(o.seriesSource === "es5m" ? METRIC.hit : HOME_THEME.muted, 0.3)}` }}>
                      {o.seriesSource === "es5m" ? "5m SPX (ES-implied)" : "30m snapshots"}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Calibration — measured accuracy of the score vs realized history */}
            <CalibrationPanel />

            {/* Collapsible tuning reference (display-only) */}
            {data.thresholds && (
              <div style={{ ...homePanelStyle, padding: 16 }}>
                <button onClick={() => setShowTuning((v) => !v)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0,
                    fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: HOME_THEME.muted,
                    display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span>{showTuning ? "▾" : "▸"}</span> Tuning Reference
                </button>
                {showTuning && (
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                    {([
                      ["Hit buffer", `${data.thresholds.hitPts} pts`, "Within this distance of the strike counts as a touch."],
                      ["Pivot threshold", `${data.thresholds.pivotPts} pts`, "Reversal of at least this far after a touch = pivot."],
                      ["Chop band", `±${data.thresholds.chopBand} pts`, "Stayed within this band after touch = chop."],
                      ["Dominance filter", `±${Math.round(data.thresholds.analogGexTol * 100)}%`, "Analog days must match GEX dominance within this window."],
                      ["Analog scan cap", `${data.thresholds.analogMax} days`, "Max prior days scanned for analogs."],
                    ] as const).map(([k, v, d]) => (
                      <div key={k} title={d} className="conf-hover" style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}` }}>
                        <div style={{ fontSize: 9, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: ".06em" }}>{k}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text, fontFamily: "monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: showTuning ? 10 : 0, fontSize: 10, color: HOME_THEME.muted, opacity: showTuning ? 1 : 0, height: showTuning ? "auto" : 0, overflow: "hidden" }}>
                  Display-only — edit these constants at the top of <code>app/api/confidence/route.ts</code> to tune.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
