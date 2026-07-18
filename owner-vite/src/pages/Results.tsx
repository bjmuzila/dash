/**
 * /dev/results — owner-only ICT results board.
 *
 * One card per ICT setup type (kind), showing how that setup has performed:
 * win-rate, W/L/chop split, average R, average MFE, and sample size. Data comes
 * from /api/ict-setups (the same rows the /ict recap records); a Today / 7d /
 * All-time filter re-queries the summary. Inherits the owner guard from
 * app/dev/layout.tsx.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "../components/PageCard";
import { HOME_THEME, classicCardAccentStyle } from "../lib/theme";

// Today's ET date as "YYYY-MM-DD" (mirrors the helper on /fails).
function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// Theme sourced from the shared dashboard palette (components/shared/homeTheme.ts) —
// single source of truth so this page matches every other page. `label`/`MUTED`
// map to HOME_THEME.text/.muted, which are both pure white in this theme (no gray text).
const C = { cyan: HOME_THEME.cyan, border: HOME_THEME.border, card: HOME_THEME.panelBg, label: HOME_THEME.text, purple: HOME_THEME.purple };
const GREEN = HOME_THEME.green, RED = HOME_THEME.red, AMBER = HOME_THEME.orange, MUTED = HOME_THEME.muted;
// Frosted card surface (matches /confidence-score and the site-wide Budget-card look).
const CARD = classicCardAccentStyle;
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

type SummaryRow = {
  kind: string;
  wins: number; losses: number; chop: number; pending: number;
  graded: number; total: number;
  win_rate: number | null; avg_r: number | null; avg_mfe: number | null;
  resolved: number; hit1: number; hit2: number; hit3: number;
  rate1: number | null; rate2: number | null; rate3: number | null;
};

const R_TIERS = [1, 2, 3] as const;

// Individual setup row (a single logged/graded play) from /api/ict-setups.
type SetupRow = {
  id?: number; setup_key: string; date: string; kind: string;
  label?: string | null; dir?: string | null; trigger_ts: number;
  price?: number | null; note?: string | null;
  target?: number | null; invalidation?: number | null;
  outcome: "pending" | "win" | "loss" | "chop";
  mfe: number; mae: number; r_multiple?: number | null;
  resolved_ts?: number | null; resolved_price?: number | null;
};

// Friendly display names for the raw kind ids the recorder writes.
const KIND_LABEL: Record<string, string> = {
  fvg: "Fair Value Gap", ifvg: "Inverse FVG", ob: "Order Block", ote: "OTE Entry",
  mss: "Market Structure Shift", bos: "Break of Structure", choch: "Change of Character",
  liquidity: "Liquidity Sweep", eqhl: "Equal H/L Sweep", inducement: "Inducement",
  turtleSoup: "Turtle Soup", judas: "Judas Swing", breaker: "Breaker Block",
  cisd: "CISD", model2022: "2022 Model", displacement: "Displacement",
};
const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

type RangeKey = "today" | "7d" | "all";
const RANGES: { key: RangeKey; label: string; qs: string }[] = [
  { key: "today", label: "Today", qs: "" },
  { key: "7d", label: "Last 7d", qs: "?all=1&since=7" },
  { key: "all", label: "All-time", qs: "?all=1" },
];

// Aggregated (all-kinds) totals for one time window — used by the shareable
// overall-results card. avg_r is weighted by `resolved` (it's only defined over
// resolved rows server-side); avg_mfe is weighted by `total` (defined over all rows).
type OverallStats = {
  wins: number; losses: number; chop: number; pending: number;
  graded: number; total: number; resolved: number;
  win_rate: number | null; avg_r: number | null; avg_mfe: number | null;
};
function aggregateOverall(rows: SummaryRow[]): OverallStats {
  const sum = (f: (r: SummaryRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const wins = sum((r) => r.wins), losses = sum((r) => r.losses), chop = sum((r) => r.chop);
  const pending = sum((r) => r.pending), graded = sum((r) => r.graded), total = sum((r) => r.total);
  const resolved = sum((r) => r.resolved);
  let rNum = 0, rDen = 0, mNum = 0, mDen = 0;
  for (const r of rows) {
    if (r.avg_r != null && r.resolved > 0) { rNum += r.avg_r * r.resolved; rDen += r.resolved; }
    if (r.avg_mfe != null && r.total > 0) { mNum += r.avg_mfe * r.total; mDen += r.total; }
  }
  return {
    wins, losses, chop, pending, graded, total, resolved,
    win_rate: graded > 0 ? wins / graded : null,
    avg_r: rDen > 0 ? rNum / rDen : null,
    avg_mfe: mDen > 0 ? mNum / mDen : null,
  };
}

function wrColor(wr: number | null): string {
  if (wr == null) return MUTED;
  if (wr >= 0.6) return GREEN;
  if (wr >= 0.45) return AMBER;
  return RED;
}

// ICT-card accent — same idea as wrColor but swaps the mid-tier gold for the
// dashboard's own cyan accent (no amber anywhere in the ICT results cards).
function ictColor(wr: number | null): string {
  if (wr == null) return MUTED;
  if (wr >= 0.6) return GREEN;
  if (wr >= 0.45) return C.cyan;
  return RED;
}

// Win-rate progress bar — rounded pill, dashboard-cyan glow, filled to win%.
function WinRateBar({ wr, color }: { wr: number | null; color: string }) {
  const p = wr != null ? Math.round(wr * 100) : 0;
  return (
    <div style={{ height: 8, width: "100%", borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}` }}>
      <div style={{ width: `${p}%`, height: "100%", borderRadius: 999, background: color, boxShadow: `0 0 8px ${rgba(color, 0.6)}` }} />
    </div>
  );
}

function StatCard({ r, onClick }: { r: SummaryRow; onClick: () => void }) {
  const wr = r.win_rate;
  const accent = ictColor(wr);
  return (
    <div
      onClick={onClick}
      title="Click to view the logged plays for this setup"
      className="card-hover"
      style={{ ...CARD, height: "100%", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, minHeight: 44 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.label, letterSpacing: "0.02em" }}>{kindLabel(r.kind)}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>{r.total} logged</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
          {wr != null ? `${Math.round(wr * 100)}%` : "—"}
        </span>
        <span style={{ fontSize: 15, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          win rate{r.graded > 0 ? ` · ${r.wins}/${r.graded}` : ""}
        </span>
      </div>

      <WinRateBar wr={wr} color={accent} />

      {/* R-target hit rates — how often the setup ran ≥1R / 2R / 3R (fails-style) */}
      <div style={{ display: "flex", gap: 6 }}>
        {R_TIERS.map((t) => {
          const rate = t === 1 ? r.rate1 : t === 2 ? r.rate2 : r.rate3;
          const hits = t === 1 ? r.hit1 : t === 2 ? r.hit2 : r.hit3;
          const ac = ictColor(rate);
          return (
            <div key={t} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 4px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t}R</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
                {rate != null ? `${Math.round(rate * 100)}%` : "—"}
              </div>
              <div style={{ fontSize: 15, color: C.label, fontFamily: "var(--font-mono)" }}>{r.resolved > 0 ? `${hits}/${r.resolved}` : ""}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 15 }}>
        <Metric label="Wins" value={String(r.wins)} color={GREEN} />
        <Metric label="Losses" value={String(r.losses)} color={RED} />
        <Metric label="Chop" value={String(r.chop)} color={MUTED} />
        <Metric label="Live" value={String(r.pending)} color={C.cyan} />
        <Metric label="Avg max R" value={r.avg_r != null ? `${r.avg_r > 0 ? "+" : ""}${r.avg_r.toFixed(2)}R` : "—"}
          color={r.avg_r == null ? MUTED : r.avg_r >= 1 ? GREEN : r.avg_r >= 0.5 ? C.cyan : RED} />
        <Metric label="Avg MFE" value={r.avg_mfe != null ? `${r.avg_mfe.toFixed(1)} pt` : "—"} color={HOME_THEME.cyan} />
      </div>
    </div>
  );
}

// ── Shareable "overall results" card — Today / Last 7D / All-Time, built to be
// screenshotted straight to X. Kept as its own captured ref so the Save-PNG
// button (rendered as a sibling, not a child) never shows up in the export.
function ShareStat({ label, stats }: { label: string; stats: OverallStats | null }) {
  const wr = stats?.win_rate ?? null;
  const accent = ictColor(wr);
  return (
    <div style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.16em" }}>{label}</span>
      <span style={{ fontSize: 52, fontWeight: 900, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1, textShadow: `0 0 24px ${rgba(accent, 0.5)}` }}>
        {wr != null ? `${Math.round(wr * 100)}%` : "—"}
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.label, fontFamily: "var(--font-mono)" }}>
        {stats ? `${stats.wins}W · ${stats.losses}L · ${stats.chop}C` : "—"}
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.cyan, fontFamily: "var(--font-mono)" }}>
        {stats?.avg_r != null ? `${stats.avg_r > 0 ? "+" : ""}${stats.avg_r.toFixed(2)}R avg` : " "}
      </span>
      <span style={{ fontSize: 14, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em" }}>
        {stats ? `${stats.total} logged` : ""}
      </span>
    </div>
  );
}

function ShareCard({
  overall, cardRef, onDownload, snap,
}: {
  overall: { today: OverallStats | null; w7d: OverallStats | null; all: OverallStats | null };
  cardRef: React.RefObject<HTMLDivElement>;
  onDownload: () => void;
  snap: "idle" | "busy" | "ok" | "err";
}) {
  return (
    <div style={{ position: "relative", marginBottom: 22 }}>
      <div
        ref={cardRef}
        style={{ ...CARD, padding: "26px 30px" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: C.cyan, letterSpacing: "0.08em" }}>CB EDGE</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em" }}>ICT Setup Results</span>
        </div>
        <div style={{ fontSize: 15, color: C.label, margin: "4px 0 20px" }}>
          Auto-graded on 5-minute follow-through — every setup logged, no cherry-picking
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <ShareStat label="Today" stats={overall.today} />
          <div style={{ width: 1, alignSelf: "stretch", background: C.border }} />
          <ShareStat label="Last 7 Days" stats={overall.w7d} />
          <div style={{ width: 1, alignSelf: "stretch", background: C.border }} />
          <ShareStat label="All-Time" stats={overall.all} />
        </div>

        <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", fontSize: 14, color: C.label }}>
          <span>cbedge.net</span>
          <span>{todayETStr()}</span>
        </div>
      </div>

      <button
        onClick={onDownload}
        disabled={snap === "busy"}
        title="Download this card as a PNG"
        style={{
          position: "absolute", top: 14, right: 14, fontSize: 13, fontWeight: 800, padding: "6px 12px", borderRadius: 8,
          cursor: "pointer", border: `1px solid ${rgba(C.cyan, 0.4)}`, fontFamily: "inherit",
          background: snap === "ok" ? rgba(GREEN, 0.18) : snap === "err" ? rgba(RED, 0.18) : rgba(C.cyan, 0.12),
          color: snap === "ok" ? GREEN : snap === "err" ? RED : C.cyan,
        }}
      >
        {snap === "busy" ? "…" : snap === "ok" ? "✓ Saved" : snap === "err" ? "✕ Failed" : "⬇ Save PNG"}
      </button>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: C.label }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

type TabKey = "ict" | "fails" | "checkpoints";

export default function Results() {
  const [tab, setTab] = useState<TabKey>("ict");
  const [range, setRange] = useState<RangeKey>("all");
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [setups, setSetups] = useState<SetupRow[]>([]);
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const qs = useMemo(() => RANGES.find((r) => r.key === range)?.qs ?? "?all=1", [range]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/ict-setups${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(Array.isArray(j.summary) ? j.summary : []);
      setSetups(Array.isArray(j.setups) ? j.setups : []);
      setLoaded(true);
    } catch (e) {
      setErr(String(e)); setLoaded(true);
    }
  }, [qs]);

  useEffect(() => {
    setLoaded(false);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Today / Last 7D / All-Time roll-up for the shareable overall-results card —
  // fetched independent of the range toggle above so all three windows are
  // always ready to post, regardless of which range the per-kind grid is on.
  const [overall, setOverall] = useState<{ today: OverallStats | null; w7d: OverallStats | null; all: OverallStats | null }>(
    { today: null, w7d: null, all: null }
  );
  const loadOverall = useCallback(async () => {
    try {
      const [jToday, j7d, jAll] = await Promise.all(
        ["", "?all=1&since=7", "?all=1"].map((q) =>
          fetch(`/api/ict-setups${q}`, { cache: "no-store" }).then((r) => r.json())
        )
      );
      setOverall({
        today: aggregateOverall(Array.isArray(jToday.summary) ? jToday.summary : []),
        w7d: aggregateOverall(Array.isArray(j7d.summary) ? j7d.summary : []),
        all: aggregateOverall(Array.isArray(jAll.summary) ? jAll.summary : []),
      });
    } catch (e) { console.error("[results] overall load failed", e); }
  }, []);
  useEffect(() => {
    loadOverall();
    const id = setInterval(loadOverall, 60_000);
    return () => clearInterval(id);
  }, [loadOverall]);

  // Save-PNG for the share card — dynamic html2canvas import (see memory
  // "html2canvas screenshot gotchas"); button lives outside the captured ref.
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const downloadShareCard = useCallback(async () => {
    if (!shareCardRef.current || snap === "busy") return;
    setSnap("busy");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(shareCardRef.current, { backgroundColor: HOME_THEME.bg, scale: 2, useCORS: true });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `cbedge-ict-results-${todayETStr()}.png`;
      a.click();
      setSnap("ok");
    } catch (e) { console.error("[results] share-card capture failed", e); setSnap("err"); }
    finally { setTimeout(() => setSnap("idle"), 1800); }
  }, [snap]);

  // Overall (all kinds) roll-up for the header.
  const totals = useMemo(() => {
    const wins = rows.reduce((s, r) => s + r.wins, 0);
    const losses = rows.reduce((s, r) => s + r.losses, 0);
    const graded = rows.reduce((s, r) => s + r.graded, 0);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const pending = rows.reduce((s, r) => s + r.pending, 0);
    return { wins, losses, graded, total, pending, wr: graded > 0 ? wins / graded : null };
  }, [rows]);

  // Sort: most-traded first, but kinds with a real win-rate float above noise.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.graded - a.graded) || (b.total - a.total)),
    [rows]
  );

  const rangeBtn = (r: typeof RANGES[number]): React.CSSProperties => ({
    fontSize: 15, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === r.key ? C.cyan : C.border}`,
    background: range === r.key ? rgba(C.cyan, 0.18) : "transparent",
    color: range === r.key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase",
    fontFamily: "inherit",
  });

  const tabBtn = (key: TabKey, _label: string): React.CSSProperties => ({
    fontSize: 15, fontWeight: 800, padding: "7px 18px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${tab === key ? C.cyan : C.border}`,
    background: tab === key ? rgba(C.cyan, 0.18) : "transparent",
    color: tab === key ? C.cyan : C.label, letterSpacing: "0.08em", textTransform: "uppercase",
    fontFamily: "inherit",
  });

  return (
    <PageShell>
      {/* Tab bar */}
      <div className="tab-strip" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button onClick={() => setTab("ict")} style={tabBtn("ict", "ICT Results")}>ICT Results</button>
        <button onClick={() => setTab("fails")} style={tabBtn("fails", "Fail Rate")}>Fail Rate</button>
        <button onClick={() => setTab("checkpoints")} style={tabBtn("checkpoints", "Confidence")}>Confidence</button>
      </div>

      {tab === "checkpoints" ? <CheckpointsView /> : tab === "fails" ? <FailsView /> : (<>
      <ShareCard overall={overall} cardRef={shareCardRef} onDownload={downloadShareCard} snap={snap} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>ICT Results</span>
        <span style={{ fontSize: 15, color: C.label }}>Per-setup performance · auto-graded by follow-through</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} style={rangeBtn(r)}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Overall roll-up */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, margin: "14px 0 20px", flexWrap: "wrap", fontFamily: "var(--font-mono)" }}>
        <span style={{ fontSize: 15, color: C.label }}>Overall</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: wrColor(totals.wr) }}>
          {totals.wr != null ? `${Math.round(totals.wr * 100)}%` : "—"}
        </span>
        <span style={{ fontSize: 15, color: C.label }}>
          {totals.wins}W · {totals.losses}L · {totals.graded} graded · {totals.pending} live · {totals.total} total
        </span>
      </div>

      {err && <div style={{ color: RED, fontSize: 15, marginBottom: 14, fontFamily: "var(--font-mono)" }}>Couldn&apos;t load results: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 15 }}>Loading results…</div>
      ) : sorted.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 15 }}>
          No setups recorded for this range yet. The ICT tracker logs and grades them every 5 min throughout
          the futures session (Sun 6pm → Fri 4pm ET) — results will populate here as setups fire and resolve.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gridAutoRows: "1fr", gap: 14 }}>
          {sorted.map((r) => <StatCard key={r.kind} r={r} onClick={() => setSelectedKind(r.kind)} />)}
        </div>
      )}

      {selectedKind && (
        <SetupLogModal
          kind={selectedKind}
          rows={setups
            .filter((s) => s.kind === selectedKind)
            .map((s) => ({
              ...s,
              trigger_ts: Number(s.trigger_ts),
              price: s.price != null ? Number(s.price) : null,
              target: s.target != null ? Number(s.target) : null,
              invalidation: s.invalidation != null ? Number(s.invalidation) : null,
              mfe: Number(s.mfe),
              mae: Number(s.mae),
              r_multiple: s.r_multiple != null ? Number(s.r_multiple) : null,
            }))
            .sort((a, b) => b.trigger_ts - a.trigger_ts)}
          onClose={() => setSelectedKind(null)}
        />
      )}
      </>)}
    </PageShell>
  );
}

// ── Modal: the log of individual plays for one ICT setup kind ──
function SetupLogModal({ kind, rows, onClose }: { kind: string; rows: SetupRow[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const th: React.CSSProperties = { padding: "8px 12px", fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: 15, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

  const oc = (o: SetupRow["outcome"]) =>
    o === "win" ? GREEN : o === "loss" ? RED : o === "chop" ? MUTED : C.cyan;
  const dirColor = (d?: string | null) => (d === "bull" ? GREEN : d === "bear" ? RED : MUTED);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: rgba(HOME_THEME.bg, 0.85), backdropFilter: "blur(3px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: HOME_THEME.panel, border: `1px solid ${C.border}`, borderTop: `3px solid ${C.cyan}`, borderRadius: 14, width: "min(960px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.label }}>{kindLabel(kind)}</span>
          <span style={{ fontSize: 15, color: C.label }}>{rows.length} logged {rows.length === 1 ? "play" : "plays"}</span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >Close ✕</button>
        </div>

        <div style={{ overflow: "auto" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "22px 24px", color: C.label, fontSize: 15 }}>No individual plays in this range.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: HOME_THEME.panel }}>
                  <th style={th}>Date</th><th style={th}>Time</th><th style={th}>Dir</th>
                  <th style={{ ...th, textAlign: "right" }}>Entry</th>
                  <th style={{ ...th, textAlign: "right" }}>Target</th>
                  <th style={{ ...th, textAlign: "right" }}>Inval</th>
                  <th style={{ ...th, textAlign: "right" }}>MFE</th>
                  <th style={{ ...th, textAlign: "right" }}>R</th>
                  <th style={{ ...th, textAlign: "center" }}>Result</th>
                  <th style={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => {
                  const rc = oc(e.outcome);
                  return (
                    <tr key={e.setup_key} style={{ borderTop: i ? `1px solid ${C.border}` : undefined, background: e.outcome === "win" ? rgba(GREEN, 0.05) : "transparent" }}>
                      <td style={{ ...td, color: C.label }}>{etDate(e.trigger_ts)}</td>
                      <td style={{ ...td, color: C.label }}>{etClock(e.trigger_ts)}</td>
                      <td style={{ ...td, color: dirColor(e.dir), fontWeight: 700 }}>{e.dir ?? "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>{e.price != null ? e.price.toFixed(2) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>{e.target != null ? e.target.toFixed(2) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>{e.invalidation != null ? e.invalidation.toFixed(2) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: HOME_THEME.cyan }}>{e.mfe != null ? e.mfe.toFixed(1) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: e.r_multiple == null ? C.label : e.r_multiple >= 1 ? GREEN : e.r_multiple < 0 ? RED : C.cyan }}>{e.r_multiple == null ? "—" : `${e.r_multiple > 0 ? "+" : ""}${e.r_multiple.toFixed(2)}R`}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ fontSize: 15, fontWeight: 800, padding: "3px 8px", borderRadius: 4, color: rc, background: `${rc}22`, border: `1px solid ${rc}59`, textTransform: "uppercase" }}>{e.outcome}</span>
                      </td>
                      <td style={{ ...td, color: C.label, fontFamily: "inherit", whiteSpace: "normal", maxWidth: 260 }}>{e.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Fail Rate tab: 20-session fail-rate history per reference level ──
// STUBBED: the original pulled live ES candles via `@/hooks/useEsCandles`
// (a ~16KB WebSocket streaming hook with its own dependency chain) and rebuilt
// per-level fail stats with `computeStats` from `@/lib/failLevels` (~40KB). Those
// modules are not part of this standalone Vite app; port them separately to
// restore this tab. The other two tabs (ICT Results, Confidence) are fully live.
function FailsView() {
  return (
    <div style={{ ...CARD, padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 16, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.1em" }}>Fail Rate</span>
      <span style={{ fontSize: 15, color: C.label }}>
        This tab is not yet available in the standalone app. It depends on the live ES candle stream
        (useEsCandles) and the fail-level engine (failLevels/computeStats), which haven&apos;t been ported.
      </span>
    </div>
  );
}

// ── Confidence tab: MVC checkpoint tracking (9:45 / 10:30 / 12:00) ──
// For each session, how close SPX got to the MVC strike that was active at each
// checkpoint, and whether it was hit (within HIT_PTS). Data: /api/confidence/checkpoints.
type CpCell = {
  key: string; label: string;
  strike: number | null; spxAt: number | null; distAt: number | null;
  closest: number | null; hit: boolean; matched: boolean;
  tiers?: Record<number, boolean | null>;
  changed?: boolean;
};
type CpDay = { date: string; checkpoints: CpCell[] };
type CpSummary = {
  key: string; label: string; samples: number; hits: number;
  hitRate: number | null; avgClosest: number | null;
  tiers?: Record<number, { hits: number; rate: number | null }>;
};
const TIERS = [5, 10, 15] as const;

function CheckpointsView() {
  const [days, setDays] = useState<CpDay[]>([]);
  const [summary, setSummary] = useState<CpSummary[]>([]);
  const [hitPts, setHitPts] = useState(8);
  const [range, setRange] = useState<"7d" | "20d" | "all">("20d");
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const qs = range === "all" ? "?all=1" : range === "7d" ? "?since=7" : "?since=20";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/confidence/checkpoints${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setDays(Array.isArray(j.days) ? j.days : []);
      setSummary(Array.isArray(j.summary) ? j.summary : []);
      if (typeof j.hitPts === "number") setHitPts(j.hitPts);
      setLoaded(true);
    } catch (e) { setErr(String(e)); setLoaded(true); }
  }, [qs]);

  useEffect(() => { setLoaded(false); load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const rangeBtn = (key: typeof range, _label: string): React.CSSProperties => ({
    fontSize: 15, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === key ? C.cyan : C.border}`,
    background: range === key ? rgba(C.cyan, 0.18) : "transparent",
    color: range === key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const distColor = (d: number | null): string => {
    if (d == null) return MUTED;
    if (d <= hitPts) return GREEN;
    if (d <= hitPts * 2.5) return AMBER;
    return RED;
  };

  const th: React.CSSProperties = { padding: "10px 14px", fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 14px", fontSize: 15, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Confidence</span>
        <span style={{ fontSize: 15, color: C.label }}>CB - Core Bullseye at 9:45 / 10:30 / 12:00 · how close SPX got · hit = within {hitPts} pts</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setRange("7d")} style={rangeBtn("7d", "7d")}>7d</button>
          <button onClick={() => setRange("20d")} style={rangeBtn("20d", "20d")}>20d</button>
          <button onClick={() => setRange("all")} style={rangeBtn("all", "All")}>All</button>
        </div>
      </div>

      {/* Per-checkpoint hit-rate roll-up */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginBottom: 22 }}>
        {summary.map((s) => {
          const accent = wrColor(s.hitRate);
          return (
            <div key={s.key} className="card-hover" style={{ ...CARD, borderTop: `2px solid ${rgba(accent, 0.5)}`, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: C.label }}>{s.label}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.samples} days</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 15, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  hit rate{s.samples > 0 ? ` · ${s.hits}/${s.samples}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 15, color: C.label, fontFamily: "var(--font-mono)" }}>
                avg closest: <span style={{ color: distColor(s.avgClosest), fontWeight: 700 }}>{s.avgClosest != null ? `${s.avgClosest.toFixed(1)} pt` : "—"}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {TIERS.map((t) => {
                  const ts = s.tiers?.[t];
                  const rate = ts?.rate ?? null;
                  const ac = wrColor(rate);
                  return (
                    <div key={t} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 4px" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.06em" }}>≤{t}pt</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
                        {rate != null ? `${Math.round(rate * 100)}%` : "—"}
                      </div>
                      <div style={{ fontSize: 15, color: C.label, fontFamily: "var(--font-mono)" }}>{ts ? `${ts.hits}/${s.samples}` : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {err && <div style={{ color: RED, fontSize: 15, marginBottom: 14, fontFamily: "var(--font-mono)" }}>Couldn&apos;t load checkpoints: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 15 }}>Loading checkpoints…</div>
      ) : days.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 15 }}>
          No MVC snapshots in this range yet.
        </div>
      ) : (
        <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}>Date</th>
                  {["9:45", "10:30", "12:00"].map((l) => (
                    <th key={l} style={{ ...th, textAlign: "center", borderLeft: `1px solid ${C.border}` }} colSpan={5}>{l} CB</th>
                  ))}
                </tr>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}></th>
                  {[0, 1, 2].map((i) => (
                    <React.Fragment key={i}>
                      <th style={{ ...th, textAlign: "right", borderLeft: `1px solid ${C.border}` }}>Strike</th>
                      <th style={{ ...th, textAlign: "right" }}>Closest</th>
                      {TIERS.map((t) => (
                        <th key={t} style={{ ...th, textAlign: "center" }}>≤{t}</th>
                      ))}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d, di) => (
                  <tr key={d.date} style={{ borderTop: di ? `1px solid ${C.border}` : undefined }}>
                    <td style={{ ...td, color: C.label }}>{d.date}</td>
                    {d.checkpoints.map((c) => (
                      <React.Fragment key={c.key}>
                        <td style={{ ...td, textAlign: "right", color: C.label, borderLeft: `1px solid ${C.border}` }}>
                          {c.strike != null ? c.strike.toFixed(0) : "—"}
                          {c.changed && (
                            <span title="CB changed at next checkpoint — window scored only until then" style={{ marginLeft: 5, fontSize: 15, color: AMBER, fontWeight: 700 }}>↻</span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right", color: distColor(c.closest), fontWeight: 700 }}>
                          {c.closest != null ? `${c.closest.toFixed(1)}` : "—"}
                        </td>
                        {TIERS.map((t) => {
                          const v = c.tiers?.[t];
                          return (
                            <td key={t} style={{ ...td, textAlign: "center" }}>
                              {!c.matched || v == null ? <span style={{ color: MUTED }}>·</span>
                                : v ? <span style={{ color: GREEN, fontWeight: 800 }}>✓</span>
                                : <span style={{ color: RED, fontWeight: 800 }}>✗</span>}
                            </td>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── ET formatters (self-contained for this owner page) ──
function etClock(ts: number) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(t));
}
function etDate(ts: number) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(t));
}
