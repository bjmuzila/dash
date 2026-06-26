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

import { useCallback, useEffect, useMemo, useState } from "react";

const C = { cyan: "#00F0FF", border: "rgba(255,255,255,0.10)", card: "rgba(13,17,25,0.55)", label: "#c9d8e8" };
const GREEN = "#22e08a", RED = "#ff6b6b", AMBER = "#ffb300", MUTED = "#9fb3c8";

type SummaryRow = {
  kind: string;
  wins: number; losses: number; chop: number; pending: number;
  graded: number; total: number;
  win_rate: number | null; avg_r: number | null; avg_mfe: number | null;
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

function StatCard({ r }: { r: SummaryRow }) {
  const wr = r.win_rate;
  const accent = wrColor(wr);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
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

export default function ResultsPage() {
  const [range, setRange] = useState<RangeKey>("all");
  const [rows, setRows] = useState<SummaryRow[]>([]);
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

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24, color: "#fff", fontFamily: "'Inter', sans-serif" }}>
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
          No setups recorded for this range yet. The ICT tracker logs and grades them every 5 min during RTH —
          results will populate here as setups fire and resolve.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {sorted.map((r) => <StatCard key={r.kind} r={r} />)}
        </div>
      )}
    </div>
  );
}
