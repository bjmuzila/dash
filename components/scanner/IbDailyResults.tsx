"use client";

/**
 * IbDailyResults — /scanner → IB Stats, very bottom.
 *
 * Daily EOD scoreboard: one row per session showing how the IB resolved and how
 * every one of the 14 rules did that day (✓ hit / ✗ miss / — not in play).
 * Rows are written at 16:30 ET by server-v2/ib-results-recorder.js into
 * ib_daily_results and read via GET /api/ib-results?symbol=ES|NQ.
 *
 * Collapsed by default; data is fetched lazily on first expand.
 */

import { useEffect, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card as ThemeCard } from "@/components/shared/PageCard";
import type { IbRuleResult } from "@/lib/ibDaily";

type Row = {
  date: string; symbol: string;
  ib_high: number | null; ib_low: number | null; ib_width: number | null;
  width_bucket: string | null; bias: string | null; first_formed: string | null;
  close_zone: string | null; break_side: string | null; break_min: number | null;
  ext_10: number | null; single_break: number | null; both_broke: number | null;
  neither_broke: number | null; failed: number | null;
  rules: IbRuleResult[] | null;
};

const RULE_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"];
const RULE_NAMES: Record<string, string> = {
  "1": "Midpoint Close Bias", "2": "Formation Order + Midpoint", "3": "Single Break Continuation",
  "4": "IB Width → Day Type", "5": "Breakout Entry + Volume", "6": "Failed Breakout Fade",
  "7": "15m FVG inside IB", "8": "Retest Continuation", "9": "Extension ≥1× Width",
  "10": "Close Location (strong)", "11": "Open Type + IB Width", "12": "Inner ORB + Alignment",
  "13": "Time Filter", "14": "Contained Day",
};

/** one-line plain-English "what does this rule claim" for the legend under the table */
const RULE_CLAIM: Record<string, string> = {
  "1": "Close vs IB midpoint calls which IB extreme gets touched first.",
  "2": "Which extreme formed first + midpoint bias agreeing = stronger first-touch call.",
  "3": "A close-confirmed break of one side holds — the other side never trades.",
  "4": "Wide IB (vs 14-day norm) → rotation/both sides; narrow/normal → single-side trend day.",
  "5": "Break with a volume surge follows through ≥ 1× IB width.",
  "6": "A break that fails back inside within 30m fades to the opposite extreme.",
  "7": "An unfilled 15m FVG inside the IB points to the extreme touched first.",
  "8": "Price retests the broken level and continues in the break direction.",
  "9": "A close-confirmed break extends ≥ 1× IB width (0.5/1/1.5/2× shown on hover).",
  "10": "Close in the top/bottom 25% of the IB, agreeing with formation order, calls first touch.",
  "11": "Open type (vs prior RTH) + width bucket predicts a single-side day.",
  "12": "The inner 30m ORB breaking in the same direction as midpoint bias confirms the bias.",
  "13": "Breaks before 11:00 ET extend ≥ 1× more often than midday/late breaks.",
  "14": "Still inside the IB at 14:00 ET → stays contained into the close.",
};

const f1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(1));
const clock = (m: number | null) =>
  m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const th: React.CSSProperties = {
  padding: "6px 8px", textAlign: "center", fontWeight: 700, fontSize: 14,
  letterSpacing: "0.03em", color: HOME_THEME.text, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "6px 8px", textAlign: "center", color: HOME_THEME.text,
  fontSize: 14, borderTop: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap",
};

function RuleCell({ r }: { r: IbRuleResult | undefined }) {
  if (!r || r.state === "off" || r.hit == null) {
    return <td style={{ ...td, opacity: 0.4 }} title={r ? `${RULE_NAMES[r.id]} — ${r.note}` : ""}>—</td>;
  }
  return (
    <td
      style={{ ...td, color: r.hit ? HOME_THEME.green : HOME_THEME.red, fontWeight: 800 }}
      title={`${RULE_NAMES[r.id]} — ${r.note}${r.side ? ` · pointed ${r.side === "H" ? "HIGH" : "LOW"}` : ""}`}
    >
      {r.hit ? "✓" : "✗"}
    </td>
  );
}

export default function IbDailyResults({ sym }: { sym: "ES" | "NQ" }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || rows[sym]) return;
    let alive = true;
    fetch(`/api/ib-results?symbol=${sym}&limit=90`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (alive) setRows((s) => ({ ...s, [sym]: j.rows ?? [] })); })
      .catch((e) => { if (alive) setErr(String(e.message || e)); });
    return () => { alive = false; };
  }, [open, sym, rows]);

  const data = rows[sym];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          alignSelf: "flex-start", padding: "8px 18px", borderRadius: 8, fontSize: 15, fontWeight: 800,
          cursor: "pointer", border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
          color: HOME_THEME.text,
        }}
      >
        {open ? "Hide daily results ▲" : "Daily Results — how the IB + every rule did, day by day ▼"}
      </button>

      {open && (
        <ThemeCard variant="budget">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.06em", color: HOME_THEME.cyan }}>
              Daily Results — {sym} · IB 60m (09:30–10:30 ET)
            </div>
            <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 3 }}>
              Recorded automatically at 16:30 ET every trading day. ✓ rule hit · ✗ rule missed · — not in play. Hover a cell for the rule + trigger.
            </div>
          </div>

          {err && <div style={{ color: HOME_THEME.red, fontSize: 15 }}>{err}</div>}
          {!err && !data && <div style={{ color: HOME_THEME.text, fontSize: 15 }}>Loading…</div>}
          {!err && data && data.length === 0 && (
            <div style={{ color: HOME_THEME.text, fontSize: 15 }}>
              No results recorded yet — the first row lands at 16:30 ET on the next trading day.
            </div>
          )}

          {!err && data && data.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Date</th>
                    <th style={th}>Width</th>
                    <th style={th}>Bkt</th>
                    <th style={th}>Bias</th>
                    <th style={th}>1st</th>
                    <th style={th}>Break</th>
                    <th style={th}>Time</th>
                    <th style={th}>1×</th>
                    {RULE_IDS.map((id) => (
                      <th key={id} style={th} title={RULE_NAMES[id]}>R{id}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => {
                    const rules: IbRuleResult[] = Array.isArray(r.rules) ? r.rules : [];
                    const byId = new Map<string, IbRuleResult>(rules.map((x) => [x.id, x]));
                    const dayType = r.both_broke ? "BOTH" : r.neither_broke ? "NONE" : r.break_side ?? (r.single_break ? "1-side" : "—");
                    return (
                      <tr key={r.date}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.date}</td>
                        <td style={td}>{f1(r.ib_width)}</td>
                        <td style={{ ...td, textTransform: "uppercase", fontSize: 13 }}>{r.width_bucket ?? "—"}</td>
                        <td style={{ ...td, color: r.bias === "H" ? HOME_THEME.green : r.bias === "L" ? HOME_THEME.red : HOME_THEME.text, fontWeight: 800 }}>
                          {r.bias ?? "—"}
                        </td>
                        <td style={td}>{r.first_formed ?? "—"}</td>
                        <td style={{ ...td, color: dayType === "H" ? HOME_THEME.green : dayType === "L" ? HOME_THEME.red : dayType === "BOTH" ? HOME_THEME.purple : HOME_THEME.text, fontWeight: 800 }}
                          title={r.failed ? "break failed back inside ≤30m" : undefined}>
                          {dayType}{r.failed ? "†" : ""}
                        </td>
                        <td style={td}>{clock(r.break_min)}</td>
                        <td style={{ ...td, color: r.ext_10 ? HOME_THEME.green : HOME_THEME.text, fontWeight: 800 }}>
                          {r.break_side ? (r.ext_10 ? "✓" : "✗") : "—"}
                        </td>
                        {RULE_IDS.map((id) => <RuleCell key={id} r={byId.get(id)} />)}
                      </tr>
                    );
                  })}
                  {/* hit-rate footer — per rule, over the rows shown */}
                  <tr>
                    <td style={{ ...td, textAlign: "left", fontWeight: 800, color: LIGHT_BLUE }} colSpan={8}>
                      HIT RATE (in-play days only, last {data.length})
                    </td>
                    {RULE_IDS.map((id) => {
                      const g = data
                        .map((r) => (Array.isArray(r.rules) ? r.rules.find((x) => x.id === id) : undefined))
                        .filter((x): x is IbRuleResult => !!x && x.state === "in" && x.hit != null);
                      const p = g.length ? (100 * g.filter((x) => x.hit).length) / g.length : null;
                      const col = p == null ? HOME_THEME.text : p >= 60 ? HOME_THEME.green : p <= 40 ? HOME_THEME.red : HOME_THEME.orange;
                      return (
                        <td key={id} style={{ ...td, color: col, fontWeight: 800 }} title={`${RULE_NAMES[id]} — ${g.length} in-play day(s)`}>
                          {p == null ? "—" : `${p.toFixed(0)}%`}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 14, fontStyle: "italic", color: HOME_THEME.text }}>
                Break column: H/L = close-confirmed break side, BOTH = rotation, NONE = contained, † = break failed back inside within 30m.
                1× = the break ran ≥ 1× IB width. Hit rates are conditional on the rule being in play, so columns have different sample sizes.
              </div>

              {/* rules legend — what each R# column is actually claiming */}
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
                <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.05em", color: LIGHT_BLUE, marginBottom: 8 }}>
                  THE RULES
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "4px 24px" }}>
                  {RULE_IDS.map((id) => (
                    <div key={id} style={{ display: "flex", gap: 8, fontSize: 14, color: HOME_THEME.text, lineHeight: 1.45 }}>
                      <span style={{ fontWeight: 800, color: HOME_THEME.cyan, minWidth: 30 }}>R{id}</span>
                      <span>
                        <span style={{ fontWeight: 700 }}>{RULE_NAMES[id]}</span>
                        <span style={{ opacity: 0.85 }}> — {RULE_CLAIM[id]}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </ThemeCard>
      )}
    </div>
  );
}
