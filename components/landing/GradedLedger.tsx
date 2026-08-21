"use client";

import { useEffect, useState } from "react";
import { HOME_THEME as T, REFRESH_GREEN, SOFT_RED } from "@/components/shared/homeTheme";

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
        <b style={{ fontSize: 13, fontWeight: 700 }}>
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
                <td style={{ ...td, ...mono, color: T.text, whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                <td style={{ ...td, ...mono, color: T.text }}>{r.level.toLocaleString("en-US")}</td>
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

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// REFRESH_GREEN, not HOME_THEME.green — the latter is the palette's light blue.
const GREEN = REFRESH_GREEN;
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

const wrap: React.CSSProperties = {
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  overflow: "hidden",
  background: "rgba(13,17,25,0.35)",
};

const head: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "12px 16px",
  background: "rgba(13,17,25,0.8)",
  borderBottom: `1px solid ${T.border}`,
};

const headMeta: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  color: T.muted,
  opacity: 0.6,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12.5,
  minWidth: 620,
};

const th: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.muted,
  opacity: 0.55,
  textAlign: "left",
  padding: "9px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.015)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  color: T.muted,
  opacity: 0.9,
  verticalAlign: "top",
};

const mono: React.CSSProperties = { fontFamily: MONO, opacity: 1 };

const chipBase: React.CSSProperties = {
  display: "inline-block",
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 800,
  padding: "3px 8px",
  borderRadius: 5,
  letterSpacing: "0.08em",
};

const chipHit: React.CSSProperties = {
  ...chipBase,
  background: hexA(GREEN, 0.14),
  color: GREEN,
  border: `1px solid ${hexA(GREEN, 0.3)}`,
};

const chipMiss: React.CSSProperties = {
  ...chipBase,
  background: hexA(T.red, 0.13),
  color: SOFT_RED,
  border: `1px solid ${hexA(T.red, 0.3)}`,
};
