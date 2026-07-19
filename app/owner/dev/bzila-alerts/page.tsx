"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { OWNER_THEME as HOME_THEME, homeShellStyle } from "@/components/shared/ownerTheme";

// Owner-only reactions dashboard for Bzila alerts. Gated by /owner/dev layout
// (OwnerGuard) + the /api/bzila-alerts/report route (owner session check).
// Shows, per alert: 👍/👎 tallies, total taps, and who reacted.

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={homeShellStyle}>
      <main style={{ flex: 1, overflow: "auto", padding: "clamp(14px,2vw,24px)", display: "flex", flexDirection: "column", gap: "clamp(16px,2vw,24px)", minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}

const C = {
  border: HOME_THEME.border,
  card: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), ${HOME_THEME.panelBg}`,
  muted: "rgba(255,255,255,0.5)",
};
const GREEN = "#1FD98A";

type Reaction = "up" | "down" | "";
type Reactor = { email: string; reaction: Reaction; clicks: number; updated_at: string };
type AlertRow = {
  id: number; title: string; body: string; created_at: string;
  up: number; down: number; clicks: number; reactors: Reactor[];
};

function fmtDate(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  return new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 68 }}>
      <span style={{ fontSize: 22, fontWeight: 500, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: 12, color: C.muted, letterSpacing: "0.02em" }}>{label}</span>
    </div>
  );
}

function reactionLabel(r: Reaction) {
  if (r === "up") return <span style={{ color: GREEN, fontWeight: 700 }}>👍 Up</span>;
  if (r === "down") return <span style={{ color: HOME_THEME.red, fontWeight: 700 }}>👎 Down</span>;
  return <span style={{ color: C.muted }}>— cleared</span>;
}

export default function BzilaAlertsReportPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/bzila-alerts/report", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) { setError(d.error); return; }
        setRows(Array.isArray(d?.alerts) ? d.alerts : []);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const totalUp = rows.reduce((s, a) => s + a.up, 0);
  const totalDown = rows.reduce((s, a) => s + a.down, 0);
  const totalTaps = rows.reduce((s, a) => s + a.clicks, 0);

  return (
    <PageShell>
      <div style={{ color: HOME_THEME.text }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: "0.01em" }}>Bzila alerts · reactions</span>
          <span style={{ fontSize: 14, color: C.muted }}>{rows.length} alerts · {totalUp} 👍 · {totalDown} 👎 · {totalTaps} taps</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={load}
            style={{ background: "rgba(255,255,255,0.06)", color: HOME_THEME.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && <div style={{ color: HOME_THEME.red, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>{error}</div>}
        {!error && !loading && rows.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>No alerts yet.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((a) => (
            <div key={a.id} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 17, fontWeight: 500 }}>{a.title || "(no title)"}</span>
                    <span style={{ fontSize: 14, color: C.muted }}>{fmtDate(a.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a.body}</div>
                </div>
                <div style={{ display: "flex", gap: 20, paddingTop: 2 }}>
                  <Stat label="Thumbs up" value={a.up} color={GREEN} />
                  <Stat label="Thumbs down" value={a.down} color={HOME_THEME.red} />
                  <Stat label="Total taps" value={a.clicks} color={HOME_THEME.text} />
                </div>
              </div>

              <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                {a.reactors.length === 0 ? (
                  <span style={{ fontSize: 14, color: C.muted }}>No reactions yet.</span>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, tableLayout: "fixed" }}>
                    <thead>
                      <tr style={{ color: C.muted, textAlign: "left" }}>
                        <th style={{ fontWeight: 400, padding: "4px 8px 4px 0", width: "50%" }}>Who</th>
                        <th style={{ fontWeight: 400, padding: "4px 8px", width: "22%" }}>Reaction</th>
                        <th style={{ fontWeight: 400, padding: "4px 8px", width: "13%", textAlign: "right" }}>Taps</th>
                        <th style={{ fontWeight: 400, padding: "4px 0 4px 8px", width: "15%", textAlign: "right" }}>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.reactors.map((r, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: "6px 8px 6px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email || "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{reactionLabel(r.reaction)}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.clicks}</td>
                          <td style={{ padding: "6px 0 6px 8px", textAlign: "right", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(r.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
