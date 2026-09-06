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
//   4. THE WINDOW IS ALWAYS ON SCREEN. The header prints the actual date range
//      of the rows below it, in every state. See the 2026-09-06 note.
//
// 2026-09-05: v3 surfaces. Every `opacity` on a text style is gone — the column
// heads and the body cells were both dimmed white, which is grey with extra
// steps. A table head is distinguished by its plate (surface2) and its type,
// not by fading it out.
//
// ── 2026-09-06: "the last 8 graded sessions are a month old" ─────────────────
//
// They were. On 2026-09-06 the newest row in `confidence_log` carrying a
// `graded_at` was 2026-07-28, and this component printed it under
// "The last 8 graded sessions — unfiltered · auto-graded daily" with no date
// anywhere in the header. Every row said Jul, so the only reader who noticed
// was the one who already knew what today was.
//
// The row dates were never the problem — the FRAME was. Two changes:
//
//   • THE WINDOW IS IN THE HEADER, ALWAYS. "Jul 17 – Jul 28" sits next to the
//     hit/miss count in every state, fresh or not. A dated table cannot go
//     quietly stale again; the worst it can do is look old, which is the
//     correct thing for an old table to look like.
//   • "AUTO-GRADED DAILY" IS A CLAIM, and it is only printed when it is true.
//     Past the route's STALE_DAYS the header says "last graded <date>" instead.
//     Saying "daily" over a six-week-old board is the exact species of lie this
//     whole section exists to accuse other people of.
//
// Past HIDE_DAYS the section renders nothing at all (rule 3): at that point it
// is not a slow scoreboard, it is an abandoned one, and it has no business on
// the page that sells the scoreboard.
//
// THE FIX FOR THE STALENESS ITSELF IS NOT HERE. `confidence_log` needs rows
// graded again — a recorder job, server-side. This component's job was to stop
// being able to hide it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Beyond this, the board is not slow — it is abandoned, and it comes off the
 * page. Deliberately much larger than the route's STALE_DAYS (10): between the
 * two the table still renders and simply tells the truth about its age.
 */
const HIDE_DAYS = 60;

interface LedgerRow {
  date: string;
  level: number;
  type: string;
  what: string;
  hit: boolean;
  outcome: string | null;
}

interface LedgerPayload {
  rows: LedgerRow[];
  /** Newest / oldest graded session in `rows`, ISO. Null when there are none. */
  newestDate: string | null;
  oldestDate: string | null;
  /** Whole days from `newestDate` to now, as the SERVER measured it. */
  ageDays: number | null;
  /** ageDays > the route's STALE_DAYS. "Auto-graded daily" is false when set. */
  stale: boolean;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function GradedLedger() {
  const [d, setD] = useState<LedgerPayload | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/public-ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        setD({
          rows: Array.isArray(j?.rows) ? j.rows : [],
          newestDate: j?.newestDate ?? null,
          oldestDate: j?.oldestDate ?? null,
          ageDays: typeof j?.ageDays === "number" ? j.ageDays : null,
          stale: !!j?.stale,
        });
      })
      .catch(() => { if (live) setD({ rows: [], newestDate: null, oldestDate: null, ageDays: null, stale: false }); });
    return () => { live = false; };
  }, []);

  // null = loading, [] = nothing graded yet. Render neither — see rule 3.
  if (!d || d.rows.length === 0) return null;
  // Abandoned, not slow. See HIDE_DAYS.
  if (d.ageDays != null && d.ageDays > HIDE_DAYS) return null;

  const rows = d.rows;
  const hits = rows.filter((r) => r.hit).length;
  // Rule 4: the window is on screen in every state. Rows arrive newest-first,
  // so the range reads oldest → newest the way a date range should.
  const range =
    d.oldestDate && d.newestDate
      ? d.oldestDate === d.newestDate
        ? fmtDate(d.newestDate)
        : `${fmtDate(d.oldestDate)} – ${fmtDate(d.newestDate)}`
      : null;

  return (
    <div style={wrap} className="graded-ledger">
      <div style={head}>
        <b style={{ fontSize: V3_TEXT.base, fontWeight: 600, color: V3.fg }}>
          The last {rows.length} graded sessions — unfiltered
        </b>
        <span style={headMeta}>
          {range && <span style={{ color: d.stale ? V3.warn : V3.fg }}>{range}</span>}
          {range && " · "}
          {hits} hit · {rows.length - hits} miss
          {/* "auto-graded daily" only while that is true — see the 2026-09-06
              note. Otherwise say when it actually last graded. */}
          {d.stale
            ? <> · <span style={{ color: V3.warn }}>last graded {fmtDate(d.newestDate!)}</span></>
            : " · auto-graded daily"}
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
  // Was nowrap. It carries the date window as well as the counts now, which is
  // wider than a phone; let it wrap rather than push the card sideways.
  lineHeight: 1.6,
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
