"use client";

import { useEffect, useState } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

// Graded-performance strip — the "receipts".
//
// Every competitor posts winners. The differentiator here is that these come
// out of the same auto-graded tables the app uses internally: hits AND misses,
// no cherry-picking, no hand-entry.
//
// The sample size is NOT fine print — it is rendered at readable weight next to
// every number, deliberately. A percentage alone is a marketing claim someone
// will (rightly) push back on; a percentage with n= is a receipt that survives
// the question "over what?". Do not shrink, grey out, or drop the n.
//
// /api/public-stats already withholds anything under its MIN_N floor, so this
// renders whatever it's handed. If that leaves nothing, the strip renders
// nothing — an empty receipts strip is better than a padded one.

interface PublicStat {
  key: string;
  label: string;
  sublabel: string;
  pct: number;
  n: number;
  since: string | null;
}

function fmtSince(since: string | null): string | null {
  if (!since) return null;
  const d = new Date(since);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function ReceiptsStrip() {
  const [stats, setStats] = useState<PublicStat[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/public-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setStats(j?.stats ?? []); })
      .catch(() => { if (live) setStats([]); });
    return () => { live = false; };
  }, []);

  // null = still loading, [] = nothing clears the bar. Render neither.
  if (!stats || stats.length === 0) return null;

  return (
    <div style={wrap} className="receipts">
      <div style={heading}>
        Tracked, auto-graded, and published — wins and misses
      </div>

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

/* ── styles ───────────────────────────────────────────────────────────── */

const wrap: React.CSSProperties = {
  marginTop: 22,
  padding: "16px 14px 12px",
  borderRadius: 14,
  background: "rgba(33,158,188,0.05)",
  border: "1px solid rgba(33,158,188,0.22)",
};

const heading: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: T.cyan,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  marginBottom: 12,
  textAlign: "center",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 10,
};

const cell: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(5,6,10,0.45)",
  border: "1px solid rgba(255,255,255,0.06)",
  textAlign: "left",
};

const pctRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 7,
  marginBottom: 3,
};

const pctVal: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: T.green,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  lineHeight: 1,
};

// Sample size — same mono family, readable weight. Intentionally not fine print.
const nVal: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: T.muted,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: T.text,
  lineHeight: 1.3,
  marginBottom: 2,
};

const subStyle: React.CSSProperties = {
  fontSize: 10,
  color: T.muted,
  lineHeight: 1.35,
};

const footnote: React.CSSProperties = {
  marginTop: 10,
  fontSize: 10,
  color: T.muted,
  opacity: 0.75,
  textAlign: "center",
  lineHeight: 1.4,
};
