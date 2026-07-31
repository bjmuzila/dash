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
        <span style={{ fontSize: 17, fontWeight: 800, color: C.label, letterSpacing: "0.02em" }}>{kindLabel(r.kind)}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>{r.total} logged</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
          {wr != null ? `${Math.round(wr * 100)}%` : "—"}
        </span>
        <span style={{ fontSize: 14, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
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
              <div style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t}R</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
                {rate != null ? `${Math.round(rate * 100)}%` : "—"}
              </div>
              <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>{r.resolved > 0 ? `${hits}/${r.resolved}` : ""}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 14 }}>
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
      <span style={{ fontSize: 14, fontWeight: 800, color: C.label, textTransform: "uppercase", letterSpacing: "0.16em" }}>{label}</span>
      <span style={{ fontSize: 52, fontWeight: 900, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1, textShadow: `0 0 24px ${rgba(accent, 0.5)}` }}>
        {wr != null ? `${Math.round(wr * 100)}%` : "—"}
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, color: C.label, fontFamily: "var(--font-mono)" }}>
        {stats ? `${stats.wins}W · ${stats.losses}L · ${stats.chop}C` : "—"}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: C.cyan, fontFamily: "var(--font-mono)" }}>
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
          <span style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.14em" }}>ICT Setup Results</span>
        </div>
        <div style={{ fontSize: 14, color: C.label, margin: "4px 0 20px" }}>
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
          position: "absolute", top: 14, right: 14, fontSize: 14, fontWeight: 800, padding: "6px 12px", borderRadius: 8,
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

type TabKey = "ict" | "fails" | "checkpoints" | "contracts";

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
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === r.key ? C.cyan : C.border}`,
    background: range === r.key ? rgba(C.cyan, 0.18) : "transparent",
    color: range === r.key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase",
    fontFamily: "inherit",
  });

  const tabBtn = (key: TabKey, _label: string): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "7px 18px", borderRadius: 8, cursor: "pointer",
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
        <button onClick={() => setTab("contracts")} style={tabBtn("contracts", "Contracts")}>Contracts</button>
      </div>

      {tab === "contracts" ? <TradesView /> : tab === "checkpoints" ? <CheckpointsView /> : tab === "fails" ? <FailsView /> : (<>
      <ShareCard overall={overall} cardRef={shareCardRef} onDownload={downloadShareCard} snap={snap} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>ICT Results</span>
        <span style={{ fontSize: 14, color: C.label }}>Per-setup performance · auto-graded by follow-through</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} style={rangeBtn(r)}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Overall roll-up */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, margin: "14px 0 20px", flexWrap: "wrap", fontFamily: "var(--font-mono)" }}>
        <span style={{ fontSize: 14, color: C.label }}>Overall</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: wrColor(totals.wr) }}>
          {totals.wr != null ? `${Math.round(totals.wr * 100)}%` : "—"}
        </span>
        <span style={{ fontSize: 14, color: C.label }}>
          {totals.wins}W · {totals.losses}L · {totals.graded} graded · {totals.pending} live · {totals.total} total
        </span>
      </div>

      {err && <div style={{ color: RED, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>Couldn&apos;t load results: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 14 }}>Loading results…</div>
      ) : sorted.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 14 }}>
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

  const th: React.CSSProperties = { padding: "8px 12px", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: 14, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

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
        style={{ background: HOME_THEME.panel, border: `1px solid ${C.border}`, borderRadius: 14, width: "min(960px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.label }}>{kindLabel(kind)}</span>
          <span style={{ fontSize: 14, color: C.label }}>{rows.length} logged {rows.length === 1 ? "play" : "plays"}</span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >Close ✕</button>
        </div>

        <div style={{ overflow: "auto" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "22px 24px", color: C.label, fontSize: 14 }}>No individual plays in this range.</div>
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
                        <span style={{ fontSize: 14, fontWeight: 800, padding: "3px 8px", borderRadius: 4, color: rc, background: `${rc}22`, border: `1px solid ${rc}59`, textTransform: "uppercase" }}>{e.outcome}</span>
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
      <span style={{ fontSize: 17, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.1em" }}>Fail Rate</span>
      <span style={{ fontSize: 14, color: C.label }}>
        This tab is not yet available in the standalone app. It depends on the live ES candle stream
        (useEsCandles) and the fail-level engine (failLevels/computeStats), which haven&apos;t been ported.
      </span>
    </div>
  );
}

// ── Confidence tab: MVC checkpoint tracking (9:45 / 10:30 / 12:00) ──
// For each session, how close SPX got to the MVC strike that was active at each
// checkpoint, and whether it was hit (within HIT_PTS). Data: /api/confidence/checkpoints.
//
// Deliberately hit rates ONLY. The dollar side of the same three checkpoints —
// what the CB-strike 0DTE contract cost, whether the <= $1.00 rule bought it,
// and what the auto-sell did with it — lives on the Contracts tab, because
// bolting three more columns onto a table that already carries a strike, a
// distance and three tier ticks per checkpoint made both halves unreadable.
// This view fetches with ?contracts=0 so the server skips that join entirely.
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

  const qs = `${range === "all" ? "?all=1" : range === "7d" ? "?since=7" : "?since=20"}&contracts=0`;

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
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
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

  const th: React.CSSProperties = { padding: "10px 14px", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 14px", fontSize: 14, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Confidence</span>
        <span style={{ fontSize: 14, color: C.label }}>CB - Core Bullseye at 9:45 / 10:30 / 12:00 · how close SPX got · hit = within {hitPts} pts</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setRange("7d")} style={rangeBtn("7d", "7d")}>7d</button>
          <button onClick={() => setRange("20d")} style={rangeBtn("20d", "20d")}>20d</button>
          <button onClick={() => setRange("all")} style={rangeBtn("all", "All")}>All</button>
        </div>
      </div>

      {/* Per-checkpoint hit-rate roll-up */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 22 }}>
        {summary.map((s) => {
          // Bare CARD, no accent strip: the ICT cards use the frosted surface
          // unadorned, and a coloured top border made these read as a different
          // card family on the same page. `accent` still colours the stat text.
          const accent = wrColor(s.hitRate);
          return (
            <div key={s.key} className="card-hover" style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: C.label }}>{s.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.samples} days</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 14, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  hit rate{s.samples > 0 ? ` · ${s.hits}/${s.samples}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>
                avg closest: <span style={{ color: distColor(s.avgClosest), fontWeight: 700 }}>{s.avgClosest != null ? `${s.avgClosest.toFixed(1)} pt` : "—"}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {TIERS.map((t) => {
                  const ts = s.tiers?.[t];
                  const rate = ts?.rate ?? null;
                  const ac = wrColor(rate);
                  return (
                    <div key={t} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 4px" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.06em" }}>≤{t}pt</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
                        {rate != null ? `${Math.round(rate * 100)}%` : "—"}
                      </div>
                      <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>{ts ? `${ts.hits}/${s.samples}` : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {err && <div style={{ color: RED, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>Couldn&apos;t load checkpoints: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 14 }}>Loading checkpoints…</div>
      ) : days.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 14 }}>
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
                            <span title="CB changed at next checkpoint — window scored only until then" style={{ marginLeft: 5, fontSize: 14, color: AMBER, fontWeight: 700 }}>↻</span>
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

// ── Contracts tab: the CB contract trade log ───────────────────────────────
// One row per checkpoint of one session: the CB-strike 0DTE contract probed on
// TastyTrade (server-v2/cb-contract-track.js, via the same /proxy/probe-rest
// pipeline /owner/probe uses), what the <= $1.00 rule paid for it, what the
// 5-10 pt auto-sell got out at, and the P&L. Data: /api/cb-trades.
//
// Clicking the contract opens the probe chart for that exact trade — the same
// chart /owner/probe draws, but plotted from cb_trade_ticks (the recorder's
// poll-by-poll marks) instead of watch_snapshots, so it covers exactly the span
// the position was live.
//
// SKIPPED ROWS ARE THE POINT. A checkpoint where the contract came back at
// $2.40 is a recorded decision, not a gap — without it the board silently
// rewrites its own history and "no trades this week" becomes indistinguishable
// from "the recorder was down". They stay in the table, greyed, with the price
// and reason that disqualified them.
type CbTrade = {
  id: number; date: string; checkpoint: string; checkpoint_label: string | null;
  ticker: string; expiration: string; side: "C" | "P";
  strike: number;              // the contract actually bought (where the walk landed)
  cb_strike: number | null;    // the CB it targets — what the sell distance measures to
  cb_price: number | null;     // what the CB strike itself cost (why the walk happened)
  walk_steps: number | null;   // strikes stepped from the CB toward the money
  occ_symbol: string | null; streamer_symbol: string | null;
  status: "skipped" | "open" | "closed"; skip_reason: string | null;
  probe_ts: number | string; probe_price: number | null; probe_bid: number | null; probe_ask: number | null;
  probe_spot: number | null; probe_dist: number | null;
  entry_ts: number | string | null; entry_price: number | null; entry_spot: number | null;
  signal_ts: number | string | null; signal_dist: number | null;   // legacy — the auto-sell that no longer exists
  best_ts: number | string | null; worst_ts: number | string | null;
  exit_ts: number | string | null; exit_price: number | null; exit_spot: number | null; exit_reason: string | null;
  last_ts: number | string | null; last_price: number | null; last_spot: number | null; last_dist: number | null;
  best_price: number | null; worst_price: number | null; closest_dist: number | null;
  pnl: number | null; pnl_usd: number | null; polls: number;
  last_error: string | null;   // why the most recent poll did not price
};
type CbSummary = {
  key: string; label: string; probes: number; trades: number; openNow: number;
  peakedUp: number; avgPeakGain: number | null; wins: number; winRate: number | null;
  avgPnl: number | null; totalPnl: number | null; totalPnlUsd: number | null; takeRate: number | null;
};
type CbConfig = {
  BUY_MIN: number; STRIKE_STEP: number; WALK_MAX_STEPS: number;
  PROBE_TICKER: string; MULTIPLIER: number; CHECKPOINT_GRACE_MIN: number;
};
type CbTick = {
  ts: number | string; mark: number | null; bid: number | null; ask: number | null;
  spot: number | null; dist: number | null;
  // Present on stream-sourced bars: the true intra-minute range. A REST-probed
  // row has these equal to `mark`, so the band collapses to the line on its own.
  mark_open: number | null; mark_high: number | null; mark_low: number | null;
  src: string | null;
};

// BIGINT columns come back from node-pg as STRINGS (no type parser is
// registered in lib/db.ts), so every timestamp has to be coerced before it goes
// anywhere near a Date. Doing it here rather than at each call site is what
// keeps "Invalid Date" out of the table.
//
// The null/"" guard is load-bearing, not defensive noise: Number(null) is 0 and
// Number("") is 0, and both pass Number.isFinite. Without it every open and
// every skipped row rendered its P&L as a confident "0.00" instead of "—" — a
// fabricated number indistinguishable from a real flat trade.
const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const contractLabel = (t: CbTrade) =>
  t.strike ? `${Number(t.strike).toFixed(0)}${t.side}` : "—";

function TradesView() {
  const [trades, setTrades] = useState<CbTrade[]>([]);
  const [summary, setSummary] = useState<CbSummary[]>([]);
  const [config, setConfig] = useState<CbConfig | null>(null);
  const [range, setRange] = useState<"7d" | "20d" | "all">("20d");
  const [showSkipped, setShowSkipped] = useState(true);
  const [openTrade, setOpenTrade] = useState<CbTrade | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const [diag, setDiag] = useState<unknown>(null);

  const qs = range === "all" ? "?all=1" : range === "7d" ? "?since=7" : "?since=20";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/cb-trades${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setTrades(Array.isArray(j.trades) ? j.trades : []);
      setSummary(Array.isArray(j.summary) ? j.summary : []);
      setConfig(j.config ?? null);
      setLoaded(true);
    } catch (e) { setErr(String(e)); setLoaded(true); }
  }, [qs]);

  useEffect(() => { setLoaded(false); load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  // Force one recorder pass. Same code path the 60s tick uses and idempotent, so
  // pressing it twice costs nothing — it just re-polls whatever is open.
  const runNow = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await fetch("/api/cb-trades", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const opened = (j.opened ?? []).length;
      const polled = j.polled?.polled ?? 0;
      const errors = j.polled?.errors ?? 0;
      setStatus({
        text: `${opened} opened · ${polled} priced · ${errors} probe error${errors === 1 ? "" : "s"}`
          + `${j.note ? ` · ${j.note}` : ""}`,
        bad: errors > 0 || (polled === 0 && (j.polled?.open ?? 0) > 0),
      });
      await load();
    } catch (e) { setStatus({ text: String(e), bad: true }); }
    finally { setBusy(false); }
  }, [load]);

  const runDiagnose = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await fetch("/api/cb-trades?diag=1", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setDiag(j);
    } catch (e) { setStatus({ text: String(e), bad: true }); }
    finally { setBusy(false); }
  }, []);

  const actionBtn = (disabled: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
    border: `1px solid ${C.border}`, background: "transparent", color: C.label,
    letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const buyMin = config?.BUY_MIN ?? 1.0;
  const mult = config?.MULTIPLIER ?? 100;

  const visible = useMemo(
    () => (showSkipped ? trades : trades.filter((t) => t.status !== "skipped")),
    [trades, showSkipped],
  );
  const totals = useMemo(() => {
    // `status === "closed"`, not `pnl != null`. Held positions now carry a
    // mark-to-market pnl all day, so the old test folded live marks into the
    // booked win rate and the net dollar figure — numbers that are supposed to
    // mean "this is what the day actually paid".
    const settled = trades.filter((t) => t.status === "closed" && t.pnl != null);
    const wins = settled.filter((t) => (n(t.pnl) ?? 0) > 0).length;
    return {
      probes: trades.length,
      taken: trades.filter((t) => t.status !== "skipped").length,
      open: trades.filter((t) => t.status === "open").length,
      closed: settled.length,
      wins,
      winRate: settled.length ? wins / settled.length : null,
      usd: settled.reduce((a, t) => a + (n(t.pnl_usd) ?? 0), 0),
    };
  }, [trades]);

  const rangeBtn = (key: typeof range): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === key ? C.cyan : C.border}`,
    background: range === key ? rgba(C.cyan, 0.18) : "transparent",
    color: range === key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const th: React.CSSProperties = { padding: "10px 14px", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 14px", fontSize: 14, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.1em" }}>Contracts</span>
        <span style={{ fontSize: 14, color: C.label }}>
          0DTE probed on TastyTrade at 9:45 / 10:30 / 12:00 · from the CB, walk toward the money to the first strike over ${buyMin.toFixed(2)} · held and re-priced every minute to the bell · ×{mult}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowSkipped((v) => !v)}
            title="Skipped rows are checkpoints that were probed but never qualified — keeping them visible is what separates 'nothing set up' from 'the recorder was down'."
            style={{
              fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${showSkipped ? C.purple : C.border}`,
              background: showSkipped ? rgba(C.purple, 0.18) : "transparent",
              color: showSkipped ? C.purple : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
            }}
          >
            Skipped {showSkipped ? "on" : "off"}
          </button>
          <button onClick={() => setRange("7d")} style={rangeBtn("7d")}>7d</button>
          <button onClick={() => setRange("20d")} style={rangeBtn("20d")}>20d</button>
          <button onClick={() => setRange("all")} style={rangeBtn("all")}>All</button>
        </div>
      </div>

      {/* Recorder controls. "Nothing is updating" is the failure this feature is
          most likely to hit — the whole thing hangs off a 60s in-process poll —
          so forcing a tick and reading the diagnosis are one click, not an SSH
          session. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => void runNow()} disabled={busy} style={actionBtn(busy)}>
          {busy ? "Running…" : "Run now"}
        </button>
        <button onClick={() => void runDiagnose()} disabled={busy} style={actionBtn(busy)}>Diagnose</button>
        {status && <span style={{ fontSize: 14, color: status.bad ? AMBER : GREEN, fontFamily: "var(--font-mono)" }}>{status.text}</span>}
      </div>

      {/* Per-checkpoint roll-up */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 22 }}>
        {summary.map((s) => {
          // Bare CARD — see the note on the Confidence cards above.
          const accent = wrColor(s.winRate);
          return (
            <div key={s.key} className="card-hover" style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Type scale is the dashboard's, not this card's own: 17 for the
                  title, 14 for everything else, C.label for text, mono only on
                  numbers — the same block the ICT and Confidence cards use. A
                  20px headline stat here made this one card shout next to them. */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: C.label, letterSpacing: "0.02em" }}>{s.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
                  {s.trades}/{s.probes} taken
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {s.winRate != null ? `${Math.round(s.winRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 14, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  win rate{s.trades > 0 ? ` · ${s.wins}/${s.trades - s.openNow}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }} title="How often the contract ever traded above what was paid — the move was there, whether or not anyone took it.">
                  Traded up
                </span>
                <span style={{ color: s.peakedUp > 0 ? GREEN : MUTED, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {s.peakedUp}/{s.trades}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }} title="Average distance from entry to the day's peak mark.">Avg peak</span>
                <span style={{ color: s.avgPeakGain == null ? MUTED : s.avgPeakGain >= 0 ? GREEN : RED, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {s.avgPeakGain != null ? `${s.avgPeakGain > 0 ? "+" : ""}${s.avgPeakGain.toFixed(2)}` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }}>Avg P&amp;L</span>
                <span style={{ color: s.avgPnl == null ? MUTED : s.avgPnl >= 0 ? GREEN : RED, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {s.avgPnl != null ? `${s.avgPnl > 0 ? "+" : ""}${s.avgPnl.toFixed(2)}` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }}>Total</span>
                <span style={{ color: s.totalPnlUsd == null ? MUTED : s.totalPnlUsd >= 0 ? GREEN : RED, fontWeight: 800, fontFamily: "var(--font-mono)" }}>
                  {s.totalPnlUsd != null ? `${s.totalPnlUsd > 0 ? "+" : "−"}$${Math.abs(s.totalPnlUsd).toFixed(0)}` : "—"}
                </span>
              </div>
              {s.openNow > 0 && (
                <span style={{ fontSize: 14, color: C.cyan, fontWeight: 700 }}>{s.openNow} open right now</span>
              )}
            </div>
          );
        })}
      </div>

      {err && <div style={{ color: RED, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>Couldn&apos;t load contracts: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 14 }}>Loading contracts…</div>
      ) : trades.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 14, lineHeight: 1.6 }}>
          No checkpoints recorded yet. The tracker writes a row per checkpoint as each session runs —
          TastyTrade has no per-contract history, so this table fills forward from the day the recorder
          went live and cannot be backfilled. First rows appear at 9:45 ET on the next trading day.
        </div>
      ) : (
        <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}>Date</th>
                  <th style={th}>Time</th>
                  <th style={th}>Contract</th>
                  <th style={{ ...th, textAlign: "right" }}>Entry</th>
                  <th style={{ ...th, textAlign: "right" }}>Peak</th>
                  <th style={{ ...th, textAlign: "right" }}>P/L</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t, i) => {
                  const skipped = t.status === "skipped";
                  // A held position is marked to its last poll. It is shown, but
                  // starred and dimmed — an unrealized number that reads exactly
                  // like a booked one is how a board starts lying to you.
                  //
                  // The flag is `status`, NOT "did the server send a pnl". Once
                  // positions began being held all day the server started writing
                  // pnl on open rows too, and a `pnl ?? live` test silently
                  // stopped starring anything — every live mark read as booked.
                  const unrealized = t.status === "open";
                  const shown = n(t.pnl) ?? (t.entry_price != null && t.last_price != null
                    ? Math.round((n(t.last_price)! - n(t.entry_price)!) * 100) / 100
                    : null);
                  const entryVsPeak = t.best_price != null && t.entry_price != null
                    ? Number(t.best_price) - Number(t.entry_price) : null;
                  return (
                    <tr key={t.id} style={{ borderTop: i ? `1px solid ${C.border}` : undefined, opacity: skipped ? 0.55 : 1 }}>
                      <td style={{ ...td, color: C.label }}>{t.date}</td>
                      <td style={{ ...td, color: C.label, fontWeight: 700 }}>{t.checkpoint_label ?? t.checkpoint}</td>
                      <td style={td}>
                        <button
                          type="button"
                          onClick={() => setOpenTrade(t)}
                          title={skipped
                            ? `${t.skip_reason ?? "not taken"} — click for detail`
                            : `${t.ticker} ${t.expiration}`
                              + `${t.cb_strike != null ? ` · CB ${Number(t.cb_strike).toFixed(0)}` : ""}`
                              + `${t.cb_price != null ? ` priced $${Number(t.cb_price).toFixed(2)}` : ""}`
                              + `${t.walk_steps ? ` · walked ${t.walk_steps} strike${t.walk_steps === 1 ? "" : "s"} in` : " · the CB itself cleared the floor"}`
                              + " · click for the probe chart"}
                          style={{
                            font: "inherit", fontFamily: "var(--font-mono)", cursor: "pointer",
                            background: "transparent", border: `1px solid ${rgba(skipped ? MUTED : C.cyan, 0.4)}`,
                            color: skipped ? MUTED : C.cyan, fontWeight: 800, borderRadius: 6, padding: "3px 9px",
                          }}
                        >
                          {contractLabel(t)}
                          {/* The CB is the target, the strike is the instrument. Showing
                              only one of them is how you end up reading a 6635C as if the
                              board had said the CB was 6635. */}
                          {t.cb_strike != null && Number(t.cb_strike) !== Number(t.strike) && (
                            <span style={{ marginLeft: 6, fontSize: 14, fontWeight: 700, color: MUTED }}>
                              ←CB {Number(t.cb_strike).toFixed(0)}
                            </span>
                          )}
                        </button>
                      </td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>
                        {t.entry_price != null ? (
                          <span title={`filled ${etClock(n(t.entry_ts) ?? 0)} · SPX ${n(t.entry_spot)?.toFixed(2) ?? "—"}`
                            + `${t.cb_price != null ? ` · the CB ${Number(t.cb_strike ?? 0).toFixed(0)} was $${Number(t.cb_price).toFixed(2)}` : ""}`}>
                            ${Number(t.entry_price).toFixed(2)}
                          </span>
                        ) : (
                          <span style={{ color: MUTED }} title={t.skip_reason ?? "not taken"}>
                            {t.probe_price != null ? `($${Number(t.probe_price).toFixed(2)})` : "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {/* The day's high-water mark, not an exit. There is no
                            sell rule any more, so this is what was there to take
                            rather than what a rule took. */}
                        {t.best_price != null ? (
                          <span
                            title={`peak $${Number(t.best_price).toFixed(2)}`
                              + `${t.best_ts ? ` at ${etClock(n(t.best_ts) ?? 0)}` : ""}`
                              + `${t.worst_price != null ? ` · low $${Number(t.worst_price).toFixed(2)}` : ""}`
                              + `${t.closest_dist != null ? ` · SPX came within ${Number(t.closest_dist).toFixed(1)} pt of the CB` : ""}`}
                            style={{ color: entryVsPeak == null ? C.label : entryVsPeak > 0 ? GREEN : MUTED, fontWeight: 700 }}
                          >
                            ${Number(t.best_price).toFixed(2)}
                            {t.best_ts != null && (
                              <span style={{ marginLeft: 5, fontSize: 14, color: MUTED }}>{etClock(n(t.best_ts) ?? 0)}</span>
                            )}
                          </span>
                        ) : <span style={{ color: MUTED }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: shown == null ? MUTED : shown >= 0 ? GREEN : RED, opacity: unrealized ? 0.75 : 1 }}>
                        {shown != null ? (
                          <>
                            {`${shown > 0 ? "+" : ""}${shown.toFixed(2)}${unrealized ? "*" : ""}`}
                            <span style={{ marginLeft: 7, fontSize: 14, fontWeight: 700, color: MUTED }}>
                              {shown >= 0 ? "+" : "−"}${Math.abs(shown * mult).toFixed(0)}
                            </span>
                          </>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 14px", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, color: MUTED }}>
            <span>{totals.probes} checkpoints probed · {totals.taken} traded · {totals.open} open</span>
            <span>{totals.winRate != null ? `${Math.round(totals.winRate * 100)}% win rate (${totals.wins}/${totals.closed})` : "nothing closed yet"}</span>
            <span style={{ color: totals.usd >= 0 ? GREEN : RED, fontWeight: 800 }}>
              net {totals.usd >= 0 ? "+" : "−"}${Math.abs(totals.usd).toFixed(0)}
            </span>
            <span style={{ marginLeft: "auto" }}>
              ←CB marks a walked strike · held to the bell, no exit rule · <span style={{ fontWeight: 800 }}>*</span> unrealized
            </span>
          </div>
        </div>
      )}

      {openTrade && <CbProbeModal trade={openTrade} mult={mult} onClose={() => setOpenTrade(null)} />}
      {diag != null && <DiagnoseModal data={diag} onClose={() => setDiag(null)} />}
    </>
  );
}

/** Raw diagnosis dump — deliberately unformatted; it is meant to be read and pasted. */
function DiagnoseModal({ data, onClose }: { data: unknown; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,6,10,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...CARD, width: "min(900px, 100%)", maxHeight: "88vh", overflow: "auto", padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.08em" }}>Recorder diagnosis</span>
          <span style={{ fontSize: 14, color: MUTED }}>recorder liveness · CB per checkpoint · a live probe · row/tick counts</span>
          <button onClick={onClose} style={{ marginLeft: "auto", font: "inherit", fontSize: 17, fontWeight: 800, cursor: "pointer", background: "transparent", border: `1px solid ${C.border}`, color: C.label, borderRadius: 7, padding: "2px 10px" }}>×</button>
        </div>
        <pre style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: C.label, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ── Probe chart popup ──────────────────────────────────────────────────────
// The /owner/probe chart, pointed at one CB trade. Same shape as ProbeChart
// there — gradient area under a cyan line, five gridlines with value labels,
// first/last timestamps, a dot on the latest point — but plotted from
// cb_trade_ticks, so the x-axis spans exactly the minutes the position was live
// rather than a rolling 1D/1W window.
const CB_METRICS = [
  { key: "mark", label: "Price", dec: 2, prefix: "$" },
  { key: "spot", label: "SPX", dec: 2, prefix: "" },
  { key: "dist", label: "Dist to CB", dec: 1, prefix: "" },
] as const;
type CbMetricKey = typeof CB_METRICS[number]["key"];

function CbProbeChart({
  ticks, metric, entry, peak,
}: {
  ticks: CbTick[]; metric: CbMetricKey;
  entry: number | null;
  peak: { v: number; ts: number } | null;   // the day's high-water mark, not an exit
}) {
  const W = 960, H = 340, PADL = 62, PADR = 16, PADT = 16, PADB = 28;
  const pts = ticks
    .map((t) => ({ ts: n(t.ts), v: n(t[metric]) }))
    .filter((p): p is { ts: number; v: number } => p.ts != null && p.v != null);

  if (pts.length < 2) {
    // Only real positions reach the chart — a never-taken checkpoint is handled
    // upstream with its own explanation. The first cut reported every one of
    // these as "0 polls recorded", which reads as a broken chart even when the
    // honest answer was "this was never a position".
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: MUTED, fontSize: 14, fontFamily: "var(--font-mono)", lineHeight: 1.7 }}>
        {pts.length === 0
          ? <>No polls recorded yet. The recorder writes one tick a minute while a position is open — if this stays at zero, the poll is failing rather than pending. Press <b>Diagnose</b>.</>
          : <>Only one poll recorded — not enough for a line.</>}
      </div>
    );
  }

  const spec = CB_METRICS.find((m) => m.key === metric)!;
  // On the price view, stream-sourced bars carry the minute's true high and low.
  // Drawing that band is the whole point of streaming: the line alone still only
  // shows one sampled price per minute, and the peak this board leads with can
  // live entirely inside the band.
  const band = metric === "mark"
    ? ticks.map((t) => ({ ts: n(t.ts), hi: n(t.mark_high), lo: n(t.mark_low) }))
      .filter((b): b is { ts: number; hi: number; lo: number } => b.ts != null && b.hi != null && b.lo != null)
    : [];
  const hasRange = band.some((b) => b.hi > b.lo);
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  // The entry line is part of the picture, not an annotation on top of it — if
  // the domain excludes it, it gets drawn off-canvas.
  const domain = [...ys];
  if (hasRange) domain.push(...band.map((b) => b.hi), ...band.map((b) => b.lo));
  if (metric === "mark" && entry != null) domain.push(entry);
  let minY = Math.min(...domain), maxY = Math.max(...domain);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.08; minY -= gpad; maxY += gpad;

  const cnt = pts.length;
  const sx = (i: number) => PADL + (cnt <= 1 ? 0 : i / (cnt - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(cnt - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;
  const fmtY = (v: number) => `${spec.prefix}${v.toFixed(spec.dec)}`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  const fmtT = (ts: number) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ts));
  // Index of the tick nearest the peak, so the high-water mark is flagged where
  // it printed. Nothing happened there — that is the point of showing it.
  const peakIdx = peak ? pts.reduce((best, p, i) => (Math.abs(p.ts - peak.ts) < Math.abs(pts[best].ts - peak.ts) ? i : best), 0) : -1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="cbwg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rgba(C.cyan, 0.28)} />
          <stop offset="100%" stopColor={rgba(C.cyan, 0)} />
        </linearGradient>
      </defs>

      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <text x={PADL - 6} y={sy(v) + 3} textAnchor="end" fontSize={11} fill={C.label} fontFamily="var(--font-mono)">{fmtY(v)}</text>
        </g>
      ))}

      {/* Entry line on the price view. Without it a rising curve reads as a
          winner even when it never got back to what was paid. */}
      {metric === "mark" && entry != null && (
        <>
          <line x1={PADL} y1={sy(entry)} x2={W - PADR} y2={sy(entry)} stroke={rgba(MUTED, 0.6)} strokeWidth={1} strokeDasharray="4 4" />
          <text x={PADL + 4} y={sy(entry) - 5} fontSize={11} fill={MUTED} fontFamily="var(--font-mono)">entry ${entry.toFixed(2)}</text>
        </>
      )}

      <path d={area} fill="url(#cbwg)" />

      {/* High/low envelope from the 1-minute stream bars. */}
      {hasRange && (
        <path
          d={`${band.map((b, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(b.hi).toFixed(1)}`).join(" ")} `
            + `${band.slice().reverse().map((b, i) => `L${sx(band.length - 1 - i).toFixed(1)},${sy(b.lo).toFixed(1)}`).join(" ")} Z`}
          fill={rgba(C.cyan, 0.16)}
        />
      )}

      <path d={path} fill="none" stroke={C.cyan} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

      {peakIdx >= 0 && (
        <>
          <line x1={sx(peakIdx)} y1={PADT} x2={sx(peakIdx)} y2={H - PADB} stroke={rgba(GREEN, 0.55)} strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={sx(peakIdx)} cy={sy(pts[peakIdx].v)} r={4} fill={GREEN} stroke="#05060a" strokeWidth={1} />
        </>
      )}
      <circle cx={sx(cnt - 1)} cy={sy(pts[cnt - 1].v)} r={3.5} fill={C.cyan} />

      <text x={PADL} y={H - 6} textAnchor="start" fontSize={11} fill={C.label} fontFamily="var(--font-mono)">{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={11} fill={C.label} fontFamily="var(--font-mono)">{fmtT(maxX)}</text>
    </svg>
  );
}

function CbProbeModal({
  trade, mult, onClose,
}: { trade: CbTrade; mult: number; onClose: () => void }) {
  const [ticks, setTicks] = useState<CbTick[] | null>(null);
  const [metric, setMetric] = useState<CbMetricKey>("mark");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTicks(null); setErr(null);
    (async () => {
      try {
        const r = await fetch(`/api/cb-trades?ticks=${trade.id}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setTicks(Array.isArray(j.ticks) ? j.ticks : []);
      } catch (e) { if (!cancelled) { setErr(String(e)); setTicks([]); } }
    })();
    return () => { cancelled = true; };
  }, [trade.id]);

  // Esc closes, and the body doesn't scroll behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const entry = n(trade.entry_price);
  const exitV = n(trade.exit_price);
  const pnl = n(trade.pnl) ?? (entry != null && n(trade.last_price) != null
    ? Math.round((n(trade.last_price)! - entry) * 100) / 100 : null);

  const stat = (label: string, value: string, color: string = C.label) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color, fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
  const tgl = (on: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
    border: `1px solid ${on ? C.cyan : C.border}`,
    background: on ? rgba(C.cyan, 0.18) : "transparent",
    color: on ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,6,10,0.72)",
        backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...CARD, width: "min(1040px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, fontFamily: "var(--font-mono)" }}>
            {trade.ticker} {contractLabel(trade)}
          </span>
          <span style={{ fontSize: 14, color: MUTED, fontFamily: "var(--font-mono)" }}>
            {trade.expiration} 0DTE · {trade.checkpoint_label ?? trade.checkpoint} checkpoint · {trade.date}
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{ marginLeft: "auto", font: "inherit", fontSize: 17, fontWeight: 800, lineHeight: 1, cursor: "pointer", background: "transparent", border: `1px solid ${C.border}`, color: C.label, borderRadius: 7, padding: "4px 11px" }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
          {stat("CB target", trade.cb_strike != null
            ? `${Number(trade.cb_strike).toFixed(0)}${trade.cb_price != null ? ` @ $${Number(trade.cb_price).toFixed(2)}` : ""}`
            : "—", C.cyan)}
          {stat("Walk", trade.walk_steps == null
            ? "—"
            : trade.walk_steps === 0
              ? "0 — the CB itself cleared the floor"
              : `${trade.walk_steps} strike${trade.walk_steps === 1 ? "" : "s"} toward the money`)}
          {stat("Entry", entry != null ? `$${entry.toFixed(2)} · ${etClock(n(trade.entry_ts) ?? 0)}` : `not taken — ${trade.skip_reason ?? "—"}`,
            entry != null ? C.label : MUTED)}
          {stat("Peak", trade.best_price != null
            ? `$${Number(trade.best_price).toFixed(2)}${trade.best_ts ? ` · ${etClock(n(trade.best_ts) ?? 0)}` : ""}`
            : "—", trade.best_price != null ? GREEN : MUTED)}
          {stat("Close", exitV != null ? `$${exitV.toFixed(2)} · ${trade.exit_reason}`
            : trade.status === "open" ? "held — still open" : "—",
          exitV != null ? AMBER : C.cyan)}
          {stat("P/L", pnl != null ? `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} · ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl * mult).toFixed(0)}` : "—",
            pnl == null ? MUTED : pnl >= 0 ? GREEN : RED)}
          {stat("Low", trade.worst_price != null
            ? `$${Number(trade.worst_price).toFixed(2)}${trade.worst_ts ? ` · ${etClock(n(trade.worst_ts) ?? 0)}` : ""}` : "—")}
          {stat("Closest to CB", trade.closest_dist != null ? `${Number(trade.closest_dist).toFixed(1)} pt` : "—")}
          {stat("Polls", String(trade.polls ?? 0))}
        </div>

        {trade.status !== "skipped" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CB_METRICS.map((m) => (
              <button key={m.key} onClick={() => setMetric(m.key)} style={tgl(metric === m.key)}>{m.label}</button>
            ))}
          </div>
        )}

        {trade.last_error && (
          <div style={{ color: AMBER, fontSize: 14, fontFamily: "var(--font-mono)", border: `1px solid ${rgba(AMBER, 0.4)}`, background: rgba(AMBER, 0.1), borderRadius: 8, padding: "9px 12px", lineHeight: 1.6 }}>
            Last poll did not price this contract — <b>{trade.last_error}</b>
            <div style={{ marginTop: 4, color: MUTED }}>
              The row stops moving when this happens; the mark shown above is the last one that did price.
            </div>
          </div>
        )}

        {err ? (
          <div style={{ color: RED, fontSize: 14, fontFamily: "var(--font-mono)", padding: "24px 0", textAlign: "center" }}>
            Couldn&apos;t load the poll curve: {err}
          </div>
        ) : trade.status === "skipped" ? (
          // Never a position, so there is no curve and never will be. Say that
          // plainly instead of rendering an empty chart frame.
          <div style={{ padding: "28px 22px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10, lineHeight: 1.75 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: AMBER, marginBottom: 6 }}>Not taken</div>
            <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>{trade.skip_reason ?? "no reason recorded"}</div>
            <div style={{ marginTop: 8, fontSize: 14, color: MUTED }}>
              Probed at {etClock(n(trade.probe_ts) ?? 0)}
              {trade.cb_price != null
                ? ` — the CB ${Number(trade.cb_strike ?? 0).toFixed(0)} came back at $${Number(trade.cb_price).toFixed(2)}`
                : ""}.
              {" "}No position was opened, so there are no polls and no curve for this checkpoint.
            </div>
          </div>
        ) : ticks == null ? (
          <div style={{ color: C.label, fontSize: 14, padding: "48px 0", textAlign: "center" }}>Loading probe history…</div>
        ) : (
          <CbProbeChart
            ticks={ticks}
            metric={metric}
            entry={entry}
            peak={trade.best_price != null && trade.best_ts != null
              ? { v: Number(trade.best_price), ts: n(trade.best_ts) as number } : null}
          />
        )}

        <div style={{ fontSize: 14, color: MUTED, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", lineHeight: 1.6 }}>
          {metric === "mark" ? "Contract mark" : metric === "spot" ? "SPX spot at each poll" : "SPX distance to the CB"}
          {metric === "mark" ? " · shaded band is the minute's true high/low from the dxLink stream" : ""}
          {" · "}streamed from <b>dxLink</b> while held, with <b>/proxy/probe-rest</b> as the fallback whenever the
          subscription goes quiet — the same pipeline /owner/probe uses. TastyTrade has no per-contract history, so this
          curve is the only record of what the position was worth; minutes the recorder was down are simply absent.
        </div>
      </div>
    </div>
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
