"use client";

import { useEffect, useState } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

// Graded-performance strip — the "receipts".
//
// Every competitor posts winners. The differentiator here is that these come
// out of the same auto-graded tables the app uses internally: hits AND misses,
// no cherry-picking, no hand-entry.
//
// The sample is NOT fine print, but it is no longer a bare `n=` chip fighting
// the percentage for attention. It now lives inside each SUBLABEL, in the unit
// that means something to a reader — "36 sessions", "402 tickers over 42 weeks",
// "N broken sessions over N days". A percentage alone is a marketing claim
// someone will (rightly) push back on; a percentage that says what it was
// measured over is a receipt that survives "over what?".
//
// So the rule holds, it just moved: every card must still disclose its own
// sample somewhere visible. If you add a stat, put the sample in its sublabel —
// never ship a naked percentage, and never reintroduce the chip for one card
// only (a lone n= on the weakest stat reads as an alibi). The API still
// computes and gates on n; see app/api/public-stats/route.ts.
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

      {/* The old footnote promised "sample sizes shown" — that was written when
          every card carried an n= chip. The sizes are still shown, just inside
          each card's own line, so the promise is reworded rather than dropped.
          Do not shorten this to only the disclaimer: the second sentence is what
          separates this strip from every screenshot-of-a-winner on the timeline. */}
      <div style={footnote}>
        Past results do not predict future performance. Every number above is
        auto-graded — wins and misses — over the period stated on the card.
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

// Fixed 2-up, not auto-fit. With four stats this is an even 2x2 block; auto-fit
// at the left column's width was landing 3-and-1 and leaving a dead cell. If a
// stat ever gets suppressed and only three publish, the hole comes back — that
// is the accepted cost of not shrinking type to force a fit.
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
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

// nVal removed with the n= chip. Sample size now reads in the sublabel — see
// the header comment. Every other font size in this file is unchanged.

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
