import { Fragment } from "react";
import { HOME_THEME as T } from "@/components/shared/homeTheme";
import {
  getConfidence7dCompleted,
  TIERS,
  type CheckpointResult,
  type CheckpointData,
} from "@/lib/confidenceCheckpoints";

// Public, real (not sample) 7-completed-session CB - Core Bullseye tracker for
// the /explore/confidence-score marketing page. Server-rendered; the data layer
// (getConfidence7dCompleted) is cached per ET day, so it refreshes once at EOD.

const GREEN = T.green, RED = T.red, AMBER = T.orange, MUTED = T.muted;

function wrColor(wr: number | null): string {
  if (wr == null) return MUTED;
  if (wr >= 0.6) return GREEN;
  if (wr >= 0.45) return AMBER;
  return RED;
}
function distColor(d: number | null): string {
  if (d == null) return MUTED;
  if (d <= 8) return GREEN;
  if (d <= 20) return AMBER;
  return RED;
}

export default async function Confidence7dTracker() {
  let data: CheckpointData;
  try {
    data = await getConfidence7dCompleted();
  } catch {
    return null; // never break the marketing page on a data hiccup
  }
  const { days, summary, hitPts } = data;
  if (!days.length) return null;

  const th: React.CSSProperties = {
    padding: "9px 12px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
    textTransform: "uppercase", color: MUTED, textAlign: "left", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "9px 12px", fontSize: 13.5, whiteSpace: "nowrap", fontFamily: "var(--font-mono)",
  };

  return (
    <section style={{ marginTop: "clamp(28px,5vw,48px)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: "clamp(18px,3vw,24px)", fontWeight: 800, color: T.text }}>
          Live 7-day CB accuracy
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          color: T.cyan, border: `1px solid ${T.border}`, borderRadius: 999, padding: "3px 9px" }}>
          Real results · last 7 sessions
        </span>
      </div>
      <p style={{ color: MUTED, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
        The Core Bullseye (CB) at 9:45 / 10:30 / 12:00 ET — how close SPX actually got to the level
        each session. A hit is within {hitPts} points. Numbers refresh at end of day.
      </p>

      {/* Per-checkpoint hit-rate cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        {summary.map((s) => {
          const accent = wrColor(s.hitRate);
          return (
            <div key={s.key} style={{
              background: "linear-gradient(180deg, rgba(33,158,188,0.04), rgba(255,255,255,0.02))",
              border: `1px solid ${T.border}`, borderTop: `3px solid ${accent}`,
              borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{s.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {s.samples} days
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 12, color: MUTED, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  hit rate{s.samples > 0 ? ` · ${s.hits}/${s.samples}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 13, color: MUTED, fontFamily: "var(--font-mono)" }}>
                avg closest: <span style={{ color: distColor(s.avgClosest), fontWeight: 700 }}>
                  {s.avgClosest != null ? `${s.avgClosest.toFixed(1)} pt` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {TIERS.map((t) => {
                  const rate = s.tiers?.[t]?.rate ?? null;
                  const ac = wrColor(rate);
                  return (
                    <div key={t} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.03)",
                      border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 4px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>≤{t}pt</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
                        {rate != null ? `${Math.round(rate * 100)}%` : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: MUTED, fontFamily: "var(--font-mono)" }}>
                        {s.tiers?.[t] ? `${s.tiers[t].hits}/${s.samples}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-day table */}
      <div style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={th}>Date</th>
                {["9:45", "10:30", "12:00"].map((l) => (
                  <th key={l} style={{ ...th, textAlign: "center", borderLeft: `1px solid ${T.border}` }} colSpan={2 + TIERS.length}>
                    {l} CB
                  </th>
                ))}
              </tr>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={th}></th>
                {[0, 1, 2].map((i) => (
                  <Fragment key={i}>
                    <th style={{ ...th, textAlign: "right", borderLeft: `1px solid ${T.border}` }}>Strike</th>
                    <th style={{ ...th, textAlign: "right" }}>Closest</th>
                    {TIERS.map((t) => (
                      <th key={t} style={{ ...th, textAlign: "center" }}>≤{t}</th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, di) => (
                <tr key={d.date} style={{ borderTop: di ? `1px solid ${T.border}` : undefined }}>
                  <td style={{ ...td, color: MUTED }}>{d.date}</td>
                  {d.checkpoints.map((c: CheckpointResult) => (
                    <Fragment key={c.key}>
                      <td style={{ ...td, textAlign: "right", color: T.text, borderLeft: `1px solid ${T.border}` }}>
                        {c.strike != null ? c.strike.toFixed(0) : "—"}
                        {c.changed && <span title="CB changed at next checkpoint" style={{ marginLeft: 5, fontSize: 11, color: AMBER, fontWeight: 700 }}>↻</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: distColor(c.closest), fontWeight: 700 }}>
                        {c.closest != null ? c.closest.toFixed(1) : "—"}
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
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ color: MUTED, fontSize: 11.5, margin: "12px 0 0", lineHeight: 1.4 }}>
        Live results from the last 7 completed sessions · updated at end of day. Full live scoring is inside the dashboard for members.
      </p>
    </section>
  );
}
