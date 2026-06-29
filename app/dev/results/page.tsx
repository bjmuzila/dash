"use client";

/**
 * /dev/results — owner-only ICT results board.
 *
 * One card per ICT setup type (kind), showing how that setup has performed:
 * win-rate, W/L/chop split, average R, average MFE, and sample size. Data comes
 * from /api/ict-setups (the same rows the /ict recap records); a Today / 7d /
 * All-time filter re-queries the summary. Inherits the owner guard from
 * app/dev/layout.tsx.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useEsCandles } from "@/hooks/useEsCandles";
import { computeStats, type FailEvent } from "@/lib/failLevels";

// Today's ET date as "YYYY-MM-DD" (mirrors the helper on /fails).
function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

const C = { cyan: "#219EBC", border: "rgba(255,255,255,0.10)", card: "rgba(13,17,25,0.55)", label: "#c9d8e8", purple: "#a78bfa" };
const GREEN = "#22e08a", RED = "#ff6b6b", AMBER = "#ffb300", MUTED = "#9fb3c8";

type SummaryRow = {
  kind: string;
  wins: number; losses: number; chop: number; pending: number;
  graded: number; total: number;
  win_rate: number | null; avg_r: number | null; avg_mfe: number | null;
};

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

function wrColor(wr: number | null): string {
  if (wr == null) return MUTED;
  if (wr >= 0.6) return GREEN;
  if (wr >= 0.45) return AMBER;
  return RED;
}

// A horizontal W/L/chop split bar.
function SplitBar({ w, l, c }: { w: number; l: number; c: number }) {
  const tot = Math.max(1, w + l + c);
  const seg = (n: number, color: string) =>
    n > 0 ? <div style={{ width: `${(n / tot) * 100}%`, background: color }} /> : null;
  return (
    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#0b1320" }}>
      {seg(w, GREEN)}{seg(l, RED)}{seg(c, MUTED)}
    </div>
  );
}

function StatCard({ r, onClick }: { r: SummaryRow; onClick: () => void }) {
  const wr = r.win_rate;
  const accent = wrColor(wr);
  return (
    <div
      onClick={onClick}
      title="Click to view the logged plays for this setup"
      style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>{kindLabel(r.kind)}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.12em" }}>{r.total} logged</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: accent, fontFamily: "monospace", lineHeight: 1 }}>
          {wr != null ? `${Math.round(wr * 100)}%` : "—"}
        </span>
        <span style={{ fontSize: 11, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          win rate{r.graded > 0 ? ` · ${r.wins}/${r.graded}` : ""}
        </span>
      </div>

      <SplitBar w={r.wins} l={r.losses} c={r.chop} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontFamily: "monospace", fontSize: 12.5 }}>
        <Metric label="Wins" value={String(r.wins)} color={GREEN} />
        <Metric label="Losses" value={String(r.losses)} color={RED} />
        <Metric label="Chop" value={String(r.chop)} color={MUTED} />
        <Metric label="Live" value={String(r.pending)} color={AMBER} />
        <Metric label="Avg R" value={r.avg_r != null ? `${r.avg_r > 0 ? "+" : ""}${r.avg_r.toFixed(2)}R` : "—"}
          color={r.avg_r == null ? MUTED : r.avg_r >= 0 ? GREEN : RED} />
        <Metric label="Avg MFE" value={r.avg_mfe != null ? `${r.avg_mfe.toFixed(1)} pt` : "—"} color="#cfe" />
      </div>
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

export default function ResultsPage() {
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
    fontSize: 11, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === r.key ? C.cyan : C.border}`,
    background: range === r.key ? "#0c2535" : "transparent",
    color: range === r.key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase",
    fontFamily: "inherit",
  });

  const tabBtn = (key: TabKey, label: string): React.CSSProperties => ({
    fontSize: 12, fontWeight: 800, padding: "7px 18px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${tab === key ? C.cyan : C.border}`,
    background: tab === key ? "#0c2535" : "transparent",
    color: tab === key ? C.cyan : C.label, letterSpacing: "0.08em", textTransform: "uppercase",
    fontFamily: "inherit",
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24, color: "#fff", fontFamily: "var(--font-inter), 'Inter', sans-serif" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button onClick={() => setTab("ict")} style={tabBtn("ict", "ICT Results")}>ICT Results</button>
        <button onClick={() => setTab("fails")} style={tabBtn("fails", "Fail Rate")}>Fail Rate</button>
        <button onClick={() => setTab("checkpoints")} style={tabBtn("checkpoints", "Confidence")}>Confidence</button>
      </div>

      {tab === "checkpoints" ? <CheckpointsView /> : tab === "fails" ? <FailsView /> : (<>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>ICT Results</span>
        <span style={{ fontSize: 12, color: C.label }}>Per-setup performance · auto-graded by follow-through</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} style={rangeBtn(r)}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Overall roll-up */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, margin: "14px 0 20px", flexWrap: "wrap", fontFamily: "monospace" }}>
        <span style={{ fontSize: 13, color: C.label }}>Overall</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: wrColor(totals.wr) }}>
          {totals.wr != null ? `${Math.round(totals.wr * 100)}%` : "—"}
        </span>
        <span style={{ fontSize: 13, color: C.label }}>
          {totals.wins}W · {totals.losses}L · {totals.graded} graded · {totals.pending} live · {totals.total} total
        </span>
      </div>

      {err && <div style={{ color: RED, fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>Couldn&apos;t load results: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 13 }}>Loading results…</div>
      ) : sorted.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", color: C.label, fontSize: 13 }}>
          No setups recorded for this range yet. The ICT tracker logs and grades them every 5 min throughout
          the futures session (Sun 6pm → Fri 4pm ET) — results will populate here as setups fire and resolve.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {sorted.map((r) => <StatCard key={r.kind} r={r} onClick={() => setSelectedKind(r.kind)} />)}
        </div>
      )}

      {selectedKind && (
        <SetupLogModal
          kind={selectedKind}
          rows={setups.filter((s) => s.kind === selectedKind).sort((a, b) => b.trigger_ts - a.trigger_ts)}
          onClose={() => setSelectedKind(null)}
        />
      )}
      </>)}
    </div>
  );
}

// ── Modal: the log of individual plays for one ICT setup kind ──
function SetupLogModal({ kind, rows, onClose }: { kind: string; rows: SetupRow[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const th: React.CSSProperties = { padding: "8px 12px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: 13, whiteSpace: "nowrap", fontFamily: "monospace" };

  const oc = (o: SetupRow["outcome"]) =>
    o === "win" ? GREEN : o === "loss" ? RED : o === "chop" ? MUTED : AMBER;
  const dirColor = (d?: string | null) => (d === "bull" ? GREEN : d === "bear" ? RED : MUTED);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(3,7,12,0.72)", backdropFilter: "blur(3px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0b121c", border: `1px solid ${C.border}`, borderTop: `3px solid ${C.cyan}`, borderRadius: 14, width: "min(960px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{kindLabel(kind)}</span>
          <span style={{ fontSize: 12, color: C.label }}>{rows.length} logged {rows.length === 1 ? "play" : "plays"}</span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >Close ✕</button>
        </div>

        <div style={{ overflow: "auto" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "22px 24px", color: C.label, fontSize: 13 }}>No individual plays in this range.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: "#0b121c" }}>
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
                    <tr key={e.setup_key} style={{ borderTop: i ? `1px solid ${C.border}` : undefined, background: e.outcome === "win" ? "rgba(34,224,138,0.05)" : "transparent" }}>
                      <td style={{ ...td, color: C.label }}>{etDate(e.trigger_ts)}</td>
                      <td style={{ ...td, color: C.label }}>{etClock(e.trigger_ts)}</td>
                      <td style={{ ...td, color: dirColor(e.dir), fontWeight: 700 }}>{e.dir ?? "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: "#fff" }}>{e.price != null ? e.price.toFixed(2) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>{e.target != null ? e.target.toFixed(2) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>{e.invalidation != null ? e.invalidation.toFixed(2) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: "#cfe" }}>{e.mfe != null ? e.mfe.toFixed(1) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: e.r_multiple == null ? C.label : e.r_multiple >= 1 ? GREEN : e.r_multiple < 0 ? RED : AMBER }}>{e.r_multiple == null ? "—" : `${e.r_multiple > 0 ? "+" : ""}${e.r_multiple.toFixed(2)}R`}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 8px", borderRadius: 4, color: rc, background: `${rc}22`, border: `1px solid ${rc}59`, textTransform: "uppercase" }}>{e.outcome}</span>
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
// Mirrors the card that used to live on /fails. Pulls ES candles, runs the same
// computeStats(20) rebuild off the prior-day/week history, and renders the
// per-level fail rate (fails / tests).
function FailsView() {
  // Fail-rate stats need the full ~20-session window.
  const { candles: liveCandles, historical, connected } = useEsCandles(true, 20);

  const candles = useMemo(() => {
    const map = new Map<string, (typeof liveCandles)[number]>();
    for (const c of historical) map.set(c.slotKey, c as (typeof liveCandles)[number]);
    for (const c of liveCandles) map.set(c.slotKey, c);
    const all = [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
    const esu = all.filter((c) => (c.symbol ?? "").toUpperCase().includes("ESU"));
    return esu.length ? esu : all;
  }, [liveCandles, historical]);

  // Only rebuild when the historical bar set changes, not on every live tick.
  const today = todayETStr();
  const historyKey = useMemo(() => {
    const hist = candles.filter((c) => c.date !== today);
    return `${hist.length}:${hist[hist.length - 1]?.slotKey ?? ""}`;
  }, [candles, today]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { stats, log } = useMemo(() => computeStats(candles, 20), [historyKey]);

  const tot = stats.reduce((a, s) => ({ fails: a.fails + s.fails, tests: a.tests + s.tests }), { fails: 0, tests: 0 });
  const pct = tot.tests ? Math.round((tot.fails / tot.tests) * 100) : 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.1em" }}>Fail Rate</span>
        <span style={{ fontSize: 12, color: C.label }}>Per-level fail rate · last ~20 sessions (ESU)</span>
        {stats.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: C.purple }}>
            {tot.fails} fails / {tot.tests} tests · {tot.tests ? `${pct}%` : "—"}
          </span>
        )}
      </div>

      {stats.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", color: C.label, fontSize: 13 }}>
          {connected ? "Building history…" : "Loading candles…"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {stats.map((st) => {
            const p = Math.round(st.failRate * 100);
            const accent = st.kind.endsWith("High") ? GREEN : RED;
            return (
              <div key={st.kind} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{st.label}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: accent }}>{st.tests ? `${p}%` : "—"}</span>
                </div>
                <div style={{ height: 6, width: "100%", borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)" }}>
                  <div style={{ width: `${p}%`, height: "100%", background: accent }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.label, fontFamily: "monospace" }}>
                  <span>{st.fails} fails</span>
                  <span>{st.breaks} breaks</span>
                  <span>{st.tests} tests</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent fail log (moved from /fails) — full ~20-session window */}
      {log.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Recent Fail Log</span>
            <span style={{ fontSize: 12, color: C.label }}>{log.length} fails</span>
          </div>
          <FailLogTable rows={log.slice(0, 100)} />
        </div>
      )}
    </>
  );
}

// ── Confidence tab: MVC checkpoint tracking (9:45 / 10:30 / 12:00) ──
// For each session, how close SPX got to the MVC strike that was active at each
// checkpoint, and whether it was hit (within HIT_PTS). Data: /api/confidence/checkpoints.
type CpCell = {
  key: string; label: string;
  strike: number | null; spxAt: number | null; distAt: number | null;
  closest: number | null; hit: boolean; matched: boolean;
};
type CpDay = { date: string; checkpoints: CpCell[] };
type CpSummary = { key: string; label: string; samples: number; hits: number; hitRate: number | null; avgClosest: number | null };

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

  const rangeBtn = (key: typeof range, label: string): React.CSSProperties => ({
    fontSize: 11, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === key ? C.cyan : C.border}`,
    background: range === key ? "#0c2535" : "transparent",
    color: range === key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const distColor = (d: number | null): string => {
    if (d == null) return MUTED;
    if (d <= hitPts) return GREEN;
    if (d <= hitPts * 2.5) return AMBER;
    return RED;
  };

  const th: React.CSSProperties = { padding: "8px 12px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: 13, whiteSpace: "nowrap", fontFamily: "monospace" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Confidence</span>
        <span style={{ fontSize: 12, color: C.label }}>MVC at 9:45 / 10:30 / 12:00 · how close SPX got · hit = within {hitPts} pts</span>
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
            <div key={s.key} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{s.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.samples} days</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: accent, fontFamily: "monospace", lineHeight: 1 }}>
                  {s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 11, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  hit rate{s.samples > 0 ? ` · ${s.hits}/${s.samples}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.label, fontFamily: "monospace" }}>
                avg closest: <span style={{ color: distColor(s.avgClosest), fontWeight: 700 }}>{s.avgClosest != null ? `${s.avgClosest.toFixed(1)} pt` : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {err && <div style={{ color: RED, fontSize: 13, marginBottom: 14, fontFamily: "monospace" }}>Couldn&apos;t load checkpoints: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 13 }}>Loading checkpoints…</div>
      ) : days.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", color: C.label, fontSize: 13 }}>
          No MVC snapshots in this range yet.
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}>Date</th>
                  {["9:45", "10:30", "12:00"].map((l) => (
                    <th key={l} style={{ ...th, textAlign: "center", borderLeft: `1px solid ${C.border}` }} colSpan={3}>{l} MVC</th>
                  ))}
                </tr>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}></th>
                  {[0, 1, 2].map((i) => (
                    <React.Fragment key={i}>
                      <th style={{ ...th, textAlign: "right", borderLeft: `1px solid ${C.border}` }}>Strike</th>
                      <th style={{ ...th, textAlign: "right" }}>Closest</th>
                      <th style={{ ...th, textAlign: "center" }}>Hit</th>
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
                        <td style={{ ...td, textAlign: "right", color: "#fff", borderLeft: `1px solid ${C.border}` }}>
                          {c.strike != null ? c.strike.toFixed(0) : "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right", color: distColor(c.closest), fontWeight: 700 }}>
                          {c.closest != null ? `${c.closest.toFixed(1)}` : "—"}
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>
                          {!c.matched ? <span style={{ color: MUTED }}>·</span>
                            : c.hit ? <span style={{ color: GREEN, fontWeight: 800 }}>✓</span>
                            : <span style={{ color: RED, fontWeight: 800 }}>✗</span>}
                        </td>
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
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(ts));
}
function etDate(ts: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(ts));
}

function FailLogTable({ rows }: { rows: FailEvent[] }) {
  const th: React.CSSProperties = { padding: "8px 12px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: 13, whiteSpace: "nowrap" };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={th}>Date</th><th style={th}>Time</th><th style={th}>Level</th><th style={th}>Trade</th>
              <th style={{ ...th, textAlign: "right" }}>Entry</th><th style={{ ...th, textAlign: "right" }}>Risk</th>
              <th style={{ ...th, textAlign: "right" }}>Max R</th><th style={{ ...th, textAlign: "right" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const above = e.direction === "above";
              const trade = above ? "Fade Short" : "Fade Long";
              const tradeColor = above ? RED : GREEN;
              const maxR = e.maxR;
              const win = (maxR ?? 0) >= 1;
              const lost = e.stopped && (maxR ?? 0) < 1;
              const open = !win && !lost;
              const rc = win ? GREEN : lost ? RED : AMBER;
              return (
                <tr key={`${e.kind}-${e.failTs}-${i}`} style={{ borderTop: i ? `1px solid ${C.border}` : undefined, background: win ? "rgba(34,224,138,0.05)" : "transparent" }}>
                  <td style={{ ...td, color: C.label }}>{etDate(e.failTs)}</td>
                  <td style={{ ...td, color: C.label }}>{etClock(e.failTs)}</td>
                  <td style={{ ...td, color: "#fff", fontWeight: 700 }}>{e.short}</td>
                  <td style={{ ...td, color: tradeColor, fontWeight: 700 }}>{trade}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: "#fff" }}>{e.level.toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: AMBER }}>{e.riskPts.toFixed(2)}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: maxR == null ? C.label : maxR >= 2 ? GREEN : maxR >= 1 ? AMBER : RED }}>{maxR == null ? "—" : `${maxR.toFixed(2)}R`}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 8px", borderRadius: 4, color: rc, background: `${rc}22`, border: `1px solid ${rc}59` }}>
                      {win ? "WIN" : open ? "OPEN" : "LOSS"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
