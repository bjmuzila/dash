"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GEX Change — Hourly Top 5 (recorded history)
//
// Read-only viewer over gex_change_top: the top 5 "★ Very strong" strikes by
// combined score, captured at the top of every RTH hour by
// server-v2/gex-change-top-recorder.js. One section per hour (most recent
// first), each a ranked 5-row table — so you can scroll back through the day and
// see which strikes were building hardest, hour by hour, without a live tab.
//
// Reads GET /proxy/gex-change-top?date=YYYY-MM-DD (defaults to today).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

type Row = {
  hour_et: number; rank: number; symbol: string; expiry: string; strike: number;
  spot: number | null; latest_chg: number | null; pct_open: number | null;
  z_score: number | null; score: number | null; window_min: number;
};
type HourBucket = { hour: number; ts: string; rows: Row[] };

const fmtGex = (v: number | null): string => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  return `${s}$${(a / 1e6).toFixed(1)}M`;
};
const fmtSigned = (v: number | null): string => (v == null ? "—" : (v >= 0 ? "+" : "") + fmtGex(v).replace("-", ""));
const fmtStrike = (v: number): string => (Number.isInteger(v) ? v.toLocaleString("en-US") : String(v));
const fmtSpot = (v: number | null): string => (v == null ? "—" : v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
const hourLabel = (h: number): string => {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm} ET`;
};

const th: CSSProperties = { textAlign: "right", padding: "6px 10px", fontSize: 12, color: HOME_THEME.subtext ?? "rgba(255,255,255,0.6)", fontWeight: 700, whiteSpace: "nowrap", borderBottom: `1px solid rgba(255,255,255,0.1)` };
const thL: CSSProperties = { ...th, textAlign: "left" };
const td: CSSProperties = { textAlign: "right", padding: "7px 10px", fontSize: 14, whiteSpace: "nowrap" };
const tdL: CSSProperties = { ...td, textAlign: "left" };

export default function GexChangeTop() {
  const [hours, setHours] = useState<HourBucket[]>([]);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((d?: string) => {
    setLoading(true); setErr(null);
    const u = new URL("/proxy/gex-change-top", window.location.origin);
    if (d) u.searchParams.set("date", d);
    fetch(u.toString(), { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { setErr(j?.error || "load failed"); setHours([]); return; }
        setHours(j.hours || []);
        setDate(j.date || "");
      })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(date || undefined), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, date]);

  return (
    <Card
      variant="budget"
      title={<span style={{ fontSize: 17 }}>GEX Change · Hourly Top 5</span>}
      subtitle={`★ Very strong picks (|Δ| ≥ $500k & |% vs open| ≥ 30%), ranked by score · captured at the top of each RTH hour${loading ? " · refreshing…" : ""}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); load(e.target.value || undefined); }}
          style={{ ...homeButtonStyle, padding: "6px 10px", fontSize: 13, colorScheme: "dark" as CSSProperties["colorScheme"] }}
        />
        <button onClick={() => load(date || undefined)} style={{ ...homeButtonStyle, padding: "6px 12px", fontSize: 13 }}>
          Refresh
        </button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, fontSize: 13, padding: "8px 0" }}>Error: {err}</div>}

      {!err && hours.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, padding: "16px 4px" }}>
          {loading ? "Loading…" : "No very-strong picks recorded yet for this date. The recorder captures the top 5 at the top of each RTH hour going forward."}
        </div>
      )}

      {hours.map((hb) => (
        <div key={hb.hour} style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <span style={{ color: HOME_THEME.orange, fontWeight: 800, fontSize: 15 }}>{hourLabel(hb.hour)}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{hb.rows.length} pick{hb.rows.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={thL}>#</th>
                  <th style={thL}>Symbol</th>
                  <th style={th}>Strike</th>
                  <th style={th}>Spot</th>
                  <th style={thL}>Expiry</th>
                  <th style={th}>{hb.rows[0]?.window_min ?? 60}m Δ GEX</th>
                  <th style={th}>% vs open</th>
                  <th style={th}>z</th>
                  <th style={th}>Score</th>
                </tr>
              </thead>
              <tbody>
                {hb.rows.map((r) => {
                  const up = (r.latest_chg ?? 0) >= 0;
                  return (
                    <tr key={`${r.symbol}-${r.expiry}-${r.strike}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ ...tdL, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>{r.rank}</td>
                      <td style={{ ...tdL, fontWeight: 800 }}>
                        {r.symbol}
                        <span style={{ marginLeft: 6, color: "#FFD166", fontWeight: 800, fontSize: 12 }}>★</span>
                      </td>
                      <td style={td}>{fmtStrike(r.strike)}</td>
                      <td style={{ ...td, color: "rgba(255,255,255,0.7)" }}>{fmtSpot(r.spot)}</td>
                      <td style={{ ...tdL, color: "rgba(255,255,255,0.7)" }}>{r.expiry}</td>
                      <td style={{ ...td, color: up ? HOME_THEME.green : HOME_THEME.red, fontWeight: 700 }}>{fmtSigned(r.latest_chg)}</td>
                      <td style={{ ...td, color: (r.pct_open ?? 0) >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                        {r.pct_open == null ? "—" : `${r.pct_open >= 0 ? "+" : ""}${r.pct_open.toFixed(0)}%`}
                      </td>
                      <td style={{ ...td, color: "rgba(255,255,255,0.6)" }}>{r.z_score == null ? "—" : `${r.z_score >= 0 ? "+" : ""}${r.z_score.toFixed(1)}σ`}</td>
                      <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 800 }}>{r.score == null ? "—" : r.score.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
        <span>Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100</span>
        <span><span style={{ color: "#FFD166" }}>★ Very strong</span> = |Δ| ≥ $500k AND |% vs open| ≥ 30%</span>
      </div>
    </Card>
  );
}
