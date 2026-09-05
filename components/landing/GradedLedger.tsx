"use client";

import { useEffect, useState } from "react";
import { V3, V3_MONO, V3_RADIUS, V3_TEXT, v3a } from "@/components/landing/v3Theme";

// ─────────────────────────────────────────────────────────────────────────────
// The graded ledger — the ROWS behind the percentages in ReceiptsStrip.
//
// ReceiptsStrip answers "how often". This answers "show me", which is the
// objection that actually stops a signup: not "what is gamma" but "is this guy
// full of it". Every competitor posts winners; the differentiator is that the
// misses are on the same table, in date order, with nothing between them.
//
// Hard rules:
//
//   1. NEVER filter, sort or slice by outcome. The route hands back the most
//      recent graded rows in date order and this renders them in that order. A
//      "last 6 sessions" table that quietly drops the bad one is worse than no
//      table at all — it is the exact thing the page accuses everyone else of.
//   2. The HIT/MISS wording must keep matching the claim the strip publishes.
//      cbReach() grades "CB levels REACHED intraday", so reached = hit here. If
//      that stat's definition ever changes, this must change with it or the two
//      halves of the same section will contradict each other.
//   3. Empty renders nothing. An empty ledger with a "no data" row reads as
//      broken; an absent section reads as an absent section.
//
// 2026-09-05: v3 surfaces. Every `opacity` on a text style is gone — the column
// heads and the body cells were both dimmed white, which is grey with extra
// steps. A table head is distinguished by its plate (surface2) and its type,
// not by fading it out.
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerRow {
  date: string;
  level: number;
  type: string;
  what: string;
  hit: boolean;
  outcome: string | null;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function GradedLedger() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/public-ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setRows(Array.isArray(j?.rows) ? j.rows : []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  // null = loading, [] = nothing graded yet. Render neither — see rule 3.
  if (!rows || rows.length === 0) return null;

  const hits = rows.filter((r) => r.hit).length;

  return (
    <div style={wrap} className="graded-ledger">
      <div style={head}>
        <b style={{ fontSize: V3_TEXT.base, fontWeight: 600, color: V3.fg }}>
          The last {rows.length} graded sessions — unfiltered
        </b>
        <span style={headMeta}>
          {hits} hit · {rows.length - hits} miss · auto-graded daily
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Session</th>
              <th style={th}>Level called</th>
              <th style={th}>Type</th>
              <th style={th}>What happened</th>
              <th style={{ ...th, textAlign: "right" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.date}-${r.level}`}>
                <td style={{ ...td, ...mono, whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                <td style={{ ...td, ...mono }}>{r.level.toLocaleString("en-US")}</td>
                <td style={td}>{r.type}</td>
                <td style={td}>{r.what}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <span style={r.hit ? chipHit : chipMiss}>{r.hit ? "HIT" : "MISS"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────── */

const wrap: React.CSSProperties = {
  border: `1px solid ${V3.line}`,
  borderRadius: V3_RADIUS.md,
  overflow: "hidden",
  background: V3.surface,
};

const head: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "10px 14px",
  background: V3.surface2,
  borderBottom: `1px solid ${V3.line}`,
};

const headMeta: React.CSSProperties = {
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  color: V3.fg,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: V3_TEXT.base,
  minWidth: 620,
};

const th: React.CSSProperties = {
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: V3.fg,
  textAlign: "left",
  padding: "8px 14px",
  borderBottom: `1px solid ${V3.line}`,
  background: V3.surface2,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "9px 14px",
  borderBottom: `1px solid ${V3.line}`,
  color: V3.fg,
  verticalAlign: "top",
};

const mono: React.CSSProperties = { fontFamily: V3_MONO };

const chipBase: React.CSSProperties = {
  display: "inline-block",
  fontFamily: V3_MONO,
  fontSize: V3_TEXT.xs,
  fontWeight: 700,
  padding: "3px 8px",
  borderRadius: V3_RADIUS.sm,
  letterSpacing: "0.08em",
};

const chipHit: React.CSSProperties = {
  ...chipBase,
  background: v3a(V3.refresh, 0.14),
  color: V3.refresh,
  border: `1px solid ${v3a(V3.refresh, 0.35)}`,
};

const chipMiss: React.CSSProperties = {
  ...chipBase,
  background: v3a(V3.red, 0.13),
  color: V3.down,
  border: `1px solid ${v3a(V3.red, 0.35)}`,
};
