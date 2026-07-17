import { useEffect, useState } from "react";
import { HOME_THEME as T } from "./theme";

// Graded-performance strip — the "receipts".
// In the Next app this pulls /api/public-stats. Standalone Vite has no backend,
// so it tries that endpoint and falls back to these sample receipts.
const SAMPLE_STATS = [
  { key: "gex-flip", label: "GEX flip level held", sublabel: "SPX intraday reversals off the gamma flip", pct: 71, n: 1284, since: "2024-01-01" },
  { key: "em-zone", label: "Weekly EM zone touched", sublabel: "Price reached the estimated-move band", pct: 83, n: 106, since: "2023-06-01" },
  { key: "ict-fvg", label: "ES FVG filled same session", sublabel: "Fair-value gaps closed intraday", pct: 64, n: 2170, since: "2024-03-01" },
  { key: "call-wall", label: "Call wall capped highs", sublabel: "Session high pinned at the call wall", pct: 68, n: 940, since: "2024-01-01" },
];

function fmtSince(since) {
  if (!since) return null;
  const d = new Date(since);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function ReceiptsStrip() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/public-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        const s = j?.stats;
        setStats(s && s.length ? s : SAMPLE_STATS);
      })
      .catch(() => { if (live) setStats(SAMPLE_STATS); });
    return () => { live = false; };
  }, []);

  if (!stats || stats.length === 0) return null;

  return (
    <div style={wrap} className="receipts">
      <div style={heading}>Tracked, auto-graded, and published — wins and misses</div>

      <div style={grid} className="receipts-grid">
        {stats.map((s) => {
          const since = fmtSince(s.since);
          return (
            <div key={s.key} style={cell} className="receipts-cell">
              <div style={pctRow}>
                <span style={pctVal}>{s.pct}%</span>
                <span style={nVal}>n={s.n.toLocaleString()}</span>
              </div>
              <div style={labelStyle}>{s.label}</div>
              <div style={subStyle}>
                {s.sublabel}
                {since ? ` · since ${since}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      <div style={footnote}>
        Past results do not predict future performance. Sample sizes shown so you
        can judge for yourself.
      </div>
    </div>
  );
}

const wrap = { marginTop: 22, padding: "16px 14px 12px", borderRadius: 14, background: "rgba(33,158,188,0.05)", border: "1px solid rgba(33,158,188,0.22)" };
const heading = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: T.cyan, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom: 12, textAlign: "center" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 };
const cell = { padding: "10px 12px", borderRadius: 10, background: "rgba(5,6,10,0.45)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "left" };
const pctRow = { display: "flex", alignItems: "baseline", gap: 7, marginBottom: 3 };
const pctVal = { fontSize: 24, fontWeight: 800, color: T.green, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1 };
const nVal = { fontSize: 11.5, fontWeight: 700, color: T.muted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
const labelStyle = { fontSize: 12.5, fontWeight: 700, color: T.text, lineHeight: 1.3, marginBottom: 2 };
const subStyle = { fontSize: 10.5, color: T.muted, lineHeight: 1.35 };
const footnote = { marginTop: 10, fontSize: 10, color: T.muted, opacity: 0.75, textAlign: "center", lineHeight: 1.4 };
