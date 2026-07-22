"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Forward Build — "where is price beginning to go?"
//
// A DIFFERENT cut than DoD Movers' 0DTE/SWING split. For every active
// strike-growth ticker, this ranks strikes on the front 0/1/2-DTE expiries by
// ACCELERATION (is today's day-over-day Δ bigger than yesterday's Δ?), not
// just total growth. A strike quietly speeding up on tomorrow's or the
// day-after's expiry shows up here before it ever becomes today's 0DTE.
//
// Reads GET /proxy/forward-build (server-v2/strike-growth-recorder.js's
// getForwardBuildLeaderboard) — one query over rows the strike-growth sweep
// already wrote, computed in Node, no live network call per request.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

type TrendPoint = { date: string; net: number };
type FwdRow = {
  symbol: string; dte: number; expiry: string; strike: number; spot: number;
  side: "call" | "put"; trend: TrendPoint[];
  delta_last: number; delta_prev: number | null; accel: number; has_accel: boolean;
};
type SortKey = "accel" | "delta_last" | "symbol" | "dte" | "strike";

// Always millions — matches the DoD Movers tab's convention (dodGex there).
const fmtM = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  return `${s}$${(a / 1e6).toFixed(2)}M`;
};
const fmtMSigned = (v: number): string => (v >= 0 ? "+" : "") + fmtM(v);
const fmtNum = (v: number): string =>
  (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dteLabel = (dte: number): string => (dte === 0 ? "0DTE" : dte === 1 ? "1DTE" : "2DTE");
const dteColor = (dte: number): string =>
  dte === 0 ? HOME_THEME.cyan : dte === 1 ? HOME_THEME.orange : HOME_THEME.purple;

// Small inline SVG sparkline of a strike's last (up to) 3 daily net-GEX
// values, normalized to its own min/max so a $2M strike and a $2B strike are
// both readable on the same tiny chart.
function Sparkline({ trend, positive }: { trend: TrendPoint[]; positive: boolean }) {
  const w = 64, h = 22, pad = 3;
  if (trend.length < 2) return <span style={{ color: HOME_THEME.text, fontSize: 11 }}>—</span>;
  const vals = trend.map((t) => t.net);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = trend.map((t, i) => {
    const x = pad + (i / (trend.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (t.net - lo) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = positive ? HOME_THEME.green : HOME_THEME.red;
  const title = trend.map((t) => `${t.date}: ${fmtMSigned(t.net)}`).join("\n");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <title>{title}</title>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => {
        const [x, y] = p.split(",");
        const last = i === pts.length - 1;
        return <circle key={i} cx={x} cy={y} r={last ? 2.2 : 1.3} fill={color} opacity={last ? 1 : 0.6} />;
      })}
    </svg>
  );
}

export default function ForwardBuildTab() {
  const [rows, setRows] = useState<FwdRow[]>([]);
  const [asOf, setAsOf] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dteFilter, setDteFilter] = useState<"all" | 0 | 1 | 2>("all");
  const [sortKey, setSortKey] = useState<SortKey>("accel");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const load = () => {
    setLoading(true); setErr(null);
    fetch("/proxy/forward-build?limit=60", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "load failed");
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setAsOf(j.asOf || "");
      })
      .catch((e) => setErr(String((e as Error)?.message || e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    let f = needle ? rows.filter((r) => r.symbol.includes(needle)) : rows;
    if (dteFilter !== "all") f = f.filter((r) => r.dte === dteFilter);
    return [...f].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === "string" || typeof y === "string")
        return (String(x ?? "") < String(y ?? "") ? -1 : String(x ?? "") > String(y ?? "") ? 1 : 0) * sortDir;
      return ((Number(x) || 0) - (Number(y) || 0)) * sortDir;
    });
  }, [rows, q, dteFilter, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "symbol" ? 1 : -1); }
  };

  const th: CSSProperties = {
    position: "sticky", top: 0, background: HOME_THEME.panel, zIndex: 2, textAlign: "right",
    padding: "10px 12px", fontSize: 11, fontWeight: 800, color: HOME_THEME.green,
    letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: `1px solid ${HOME_THEME.border}`,
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const td: CSSProperties = {
    padding: "8px 12px", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.05)",
    whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
  };
  const posNeg = (v: number): CSSProperties => ({ color: v >= 0 ? HOME_THEME.green : HOME_THEME.red });

  const cols: { k: SortKey | "trend" | "spot" | "side"; label: string; sortable: boolean; l?: boolean }[] = [
    { k: "symbol", label: "Ticker", sortable: true, l: true },
    { k: "dte", label: "DTE", sortable: true },
    { k: "strike", label: "Strike", sortable: true },
    { k: "side", label: "Side", sortable: false },
    { k: "spot", label: "Spot", sortable: false },
    { k: "trend", label: "3-Day Trend", sortable: false },
    { k: "delta_last", label: "Today's Δ", sortable: true },
    { k: "accel", label: "Accel", sortable: true },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text }}>
          {loading ? "Loading forward build…"
            : asOf ? `Accelerating strikes across 0/1/2-DTE · as of ${asOf} · ${rows.length} rows`
            : "No forward-build rows yet (needs live dxLink data + a few sessions of history)."}
        </div>
        <select
          value={dteFilter}
          onChange={(e) => setDteFilter(e.target.value === "all" ? "all" : (Number(e.target.value) as 0 | 1 | 2))}
          style={{ ...homeInputStyle, cursor: "pointer" }}
        >
          <option value="all">All DTE</option>
          <option value={0}>0DTE only</option>
          <option value={1}>1DTE only</option>
          <option value={2}>2DTE only</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter ticker…"
          style={{ ...homeInputStyle, minWidth: 170 }}
        />
        <button onClick={load} style={homeButtonStyle}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red }}>Error: {err}</div>}
      <Card variant="budget" accent={HOME_THEME.green} title="Forward Build — accelerating strikes ahead of today">
        <div style={{ maxHeight: "72vh", overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.k}
                    onClick={c.sortable ? () => onSort(c.k as SortKey) : undefined}
                    style={{ ...th, textAlign: c.l ? "left" : "right", cursor: c.sortable ? "pointer" : "default" }}
                  >
                    {c.label}{c.sortable && sortKey === c.k ? (sortDir < 0 ? " ▼" : " ▲") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={`${r.symbol}-${r.expiry}-${r.strike}-${i}`}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800, color: HOME_THEME.cyan, letterSpacing: "0.03em" }}>{r.symbol}</td>
                  <td style={{ ...td, fontWeight: 700, color: dteColor(r.dte) }}>{dteLabel(r.dte)}</td>
                  <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>{fmtNum(r.strike)}</td>
                  <td style={{ ...td, ...(r.side === "call" ? posNeg(1) : posNeg(-1)), textTransform: "capitalize" }}>{r.side}</td>
                  <td style={{ ...td, color: HOME_THEME.text }}>{fmtNum(r.spot)}</td>
                  <td style={{ ...td, padding: "4px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Sparkline trend={r.trend} positive={r.delta_last >= 0} />
                    </div>
                  </td>
                  <td style={{ ...td, ...posNeg(r.delta_last), fontWeight: 700 }}>{fmtMSigned(r.delta_last)}</td>
                  <td style={{ ...td, ...(r.has_accel ? posNeg(r.accel) : { color: HOME_THEME.text }), fontWeight: 800 }}>
                    {r.has_accel ? fmtMSigned(r.accel) : "—"}
                  </td>
                </tr>
              ))}
              {!loading && !view.length && (
                <tr><td colSpan={cols.length} style={{ ...td, textAlign: "center", color: HOME_THEME.text, padding: 22 }}>
                  No rows to show.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: HOME_THEME.text, marginTop: 8, lineHeight: 1.6 }}>
          <b>DTE</b> = days to expiry as of the latest session (0 = today&rsquo;s expiry, 1/2 = tomorrow&rsquo;s / day-after&rsquo;s).
          <b> Today&rsquo;s Δ</b> = latest session&rsquo;s net GEX change vs the prior session. <b>Accel</b> = today&rsquo;s Δ minus
          the Δ before it — positive and growing means the strike is speeding up, not just big; &ldquo;—&rdquo; means only 2
          sessions of history exist yet (no second Δ to compare). Rows under {fmtM(20e6)} net are filtered out as noise.
          Sort by Accel to see which strike is building fastest on tomorrow&rsquo;s / the day-after&rsquo;s expiry — often where
          price is headed before it becomes today&rsquo;s 0DTE.
        </div>
      </Card>
    </>
  );
}
