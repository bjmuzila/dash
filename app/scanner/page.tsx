"use client";

/**
 * /scanner — cross-ticker GEX-change scanner (stocks only).
 *
 * Ranks the biggest per-strike volume-GEX changes over a 15/30/60-min window
 * across the whole watchlist, AND flags moves that are abnormally large vs that
 * strike's OWN typical move today (z-score). Sort by anomaly (z) to catch the
 * unusual stuff, or by raw size for the plain leaderboard. Data comes from the
 * strike_growth recorder via /proxy/strike-growth/scanner.
 */

import { useCallback, useEffect, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

type Row = {
  symbol: string;
  expiry: string;
  strike: number;
  latest_chg: number;
  mean_chg: number;
  sd_chg: number;
  n: number;
  z: number | null;
};
type Win = 15 | 30 | 60;
type Sort = "z" | "abs";

const NEUTRAL = "#6B7280";

const fmtB = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

export default function ScannerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(15);
  const [sort, setSort] = useState<Sort>("z");
  const [minZ, setMinZ] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/strike-growth/scanner", window.location.origin);
      u.searchParams.set("window", String(win));
      u.searchParams.set("sort", sort);
      u.searchParams.set("minZ", String(minZ));
      u.searchParams.set("limit", "25");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON). Recorder may not have run yet.`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, sort, minZ]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  const seg = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700,
    border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
    background: active ? "rgba(33,158,188,0.15)" : "transparent",
    color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
  });

  // z-score → color: higher = more unusual. ≥3 red-hot, ≥2 orange, else muted.
  const zColor = (z: number | null) =>
    z == null ? "rgba(255,255,255,0.4)"
    : Math.abs(z) >= 3 ? HOME_THEME.red
    : Math.abs(z) >= 2 ? HOME_THEME.orange
    : HOME_THEME.text;

  return (
    <PageShell>
      <Card accent={NEUTRAL} title="GEX Change Scanner"
        subtitle={`Stocks only · biggest ${win}m moves${sort === "z" ? " ranked by how unusual they are" : " by size"}${loading ? " · refreshing…" : ""}`}>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[15, 30, 60].map((w) => (
              <button key={w} onClick={() => setWin(w as Win)} style={seg(win === w)}>{w}m</button>
            ))}
          </div>
          <span style={{ color: HOME_THEME.border }}>|</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setSort("z")} style={seg(sort === "z")}>Most unusual (z)</button>
            <button onClick={() => setSort("abs")} style={seg(sort === "abs")}>Biggest (size)</button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.green }}>
            min z
            <select value={minZ} onChange={(e) => setMinZ(Number(e.target.value))}
              style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
              <option value={0}>any</option>
              <option value={1.5}>1.5+</option>
              <option value={2}>2.0+</option>
              <option value={3}>3.0+</option>
            </select>
          </label>
          <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        </div>

        {err && <div style={{ color: HOME_THEME.red, marginBottom: 12 }}>{err}</div>}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ ...th, textAlign: "left" }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                <th style={th}>Strike</th>
                <th style={{ ...th, textAlign: "left" }}>Expiry</th>
                <th style={th}>{win}m Δ</th>
                <th style={th}>Avg Δ</th>
                <th style={th}>z-score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const up = r.latest_chg >= 0;
                const col = up ? HOME_THEME.green : HOME_THEME.red;
                return (
                  <tr key={`${r.symbol}-${r.expiry}-${r.strike}`}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>
                    <td style={td}>{r.strike}</td>
                    <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{r.expiry}</td>
                    <td style={{ ...td, color: col, fontWeight: 800 }}>{fmtB(r.latest_chg)}</td>
                    <td style={td}>{fmtB(r.mean_chg)}</td>
                    <td style={{ ...td, color: zColor(r.z), fontWeight: 800 }}>
                      {r.z == null ? "—" : `${r.z >= 0 ? "+" : ""}${r.z.toFixed(1)}σ`}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && !loading && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                  No qualifying moves yet. Needs ≥3 snapshots spanning the window — give the recorder ~{win + 10} min of history.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em" };
const td: React.CSSProperties = { padding: "6px 10px", textAlign: "right", color: HOME_THEME.text };
