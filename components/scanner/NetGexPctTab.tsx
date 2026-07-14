"use client";

/**
 * NetGexPctTab — /scanner → "Net GEX %"
 *
 * Every ticker on the EM watchlist that has an option chain, scored by its
 * signed net-GEX share of total gamma — the same normalized ± number the home
 * GEX chart shows:
 *
 *     netGexPct = Σ netGEX / Σ |netGEX| × 100        (−100 … +100)
 *
 * +100 → all gamma on the board is positive (dealers long gamma, pinning).
 * −100 → all short gamma (unstable / trend-accelerating).
 *
 * Two columns per ticker: the nearest expiration alone, and every expiration
 * inside the recorder's DTE window summed together.
 *
 * Data: /proxy/net-gex-pct (server-v2/net-gex-pct-recorder.js, 30m RTH sweep).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card as ThemeCard } from "@/components/shared/PageCard";

type Row = {
  symbol: string;
  spot: number;
  near_expiry: string | null;
  near_dte: number | null;
  near_pct: number | null;
  near_net: number | null;
  near_abs: number | null;
  near_pct_vol: number | null;
  all_pct: number | null;
  all_net: number | null;
  all_abs: number | null;
  all_pct_vol: number | null;
  exp_count: number | null;
  date: string;
  ts: string;
};

type Basis = "oivol" | "vol";
type SortKey = "all_abs" | "all_pct" | "near_pct" | "symbol" | "spot";
type Filter = "all" | "pos" | "neg";

const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const fmtB = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const pctColor = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "rgba(255,255,255,0.35)";
  return n >= 0 ? HOME_THEME.green : HOME_THEME.red;
};

/** −100…+100 → a centered bar: negative fills left of center, positive right. */
function PctBar({ pct }: { pct: number | null }) {
  const v = pct == null || !Number.isFinite(pct) ? 0 : Math.max(-100, Math.min(100, pct));
  const half = Math.abs(v) / 2; // % of full width, each side is 50%
  const color = pctColor(pct);
  return (
    <div style={{ position: "relative", height: 8, width: "100%", background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.22)" }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: v >= 0 ? "50%" : `${50 - half}%`,
          width: `${half}%`,
          background: color,
          opacity: 0.85,
          borderRadius: 4,
        }}
      />
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "right",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "rgba(255,255,255,0.55)",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  whiteSpace: "nowrap",
  cursor: "pointer",
  userSelect: "none",
};
const td: React.CSSProperties = {
  textAlign: "right",
  padding: "9px 10px",
  fontSize: 14,
  color: "#fff",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  whiteSpace: "nowrap",
};

export default function NetGexPctTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [maxDte, setMaxDte] = useState<number>(30);
  const [basis, setBasis] = useState<Basis>("oivol");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("all_abs");
  const [asc, setAsc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/proxy/net-gex-pct?limit=600", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setRows(Array.isArray(j.rows) ? j.rows : []);
      if (Number.isFinite(j.maxDte)) setMaxDte(Number(j.maxDte));
    } catch (e: any) {
      setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  const nearOf = (r: Row) => (basis === "vol" ? r.near_pct_vol : r.near_pct);
  const allOf  = (r: Row) => (basis === "vol" ? r.all_pct_vol  : r.all_pct);

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    let out = rows.filter((r) => {
      if (needle && !r.symbol.includes(needle)) return false;
      const a = allOf(r);
      if (filter === "pos" && !(a != null && a > 0)) return false;
      if (filter === "neg" && !(a != null && a < 0)) return false;
      return true;
    });
    const val = (r: Row): number | string => {
      switch (sortKey) {
        case "symbol": return r.symbol;
        case "spot": return r.spot ?? 0;
        case "near_pct": return nearOf(r) ?? -999;
        case "all_pct": return allOf(r) ?? -999;
        default: return r.all_abs ?? 0;
      }
    };
    out = [...out].sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return asc ? c : -c;
    });
    return out;
  }, [rows, q, filter, sortKey, asc, basis]);

  const toggle = (k: SortKey) => {
    if (sortKey === k) setAsc((v) => !v);
    else { setSortKey(k); setAsc(k === "symbol"); }
  };
  const caret = (k: SortKey) => (sortKey === k ? (asc ? " ▲" : " ▼") : "");

  const posCount = view.filter((r) => (allOf(r) ?? 0) > 0).length;
  const negCount = view.filter((r) => (allOf(r) ?? 0) < 0).length;
  const asOf = rows[0]?.ts ? new Date(rows[0].ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;

  const chip = (active: boolean, color = LIGHT_BLUE): React.CSSProperties => ({
    padding: "5px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: active ? "#fff" : "rgba(255,255,255,0.6)",
    background: active ? `${color}22` : "transparent",
    border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
  });

  return (
    <ThemeCard
      title="Net GEX %"
      subtitle={`Optionable EM-watchlist tickers · Σ netGEX ÷ Σ|netGEX| · ${basis === "vol" ? "vol-only" : "OI+Vol"} basis · all-expiry window ≤ ${maxDte}d${asOf ? ` · as of ${asOf}` : ""}${loading ? " · loading…" : ""}`}
    >
      {/* controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter ticker…"
          style={{
            padding: "6px 10px", borderRadius: 8, fontSize: 13, width: 140,
            background: "rgba(255,255,255,0.04)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.1)", outline: "none",
          }}
        />
        <button onClick={() => setBasis("oivol")} style={chip(basis === "oivol")}>OI+Vol</button>
        <button onClick={() => setBasis("vol")} style={chip(basis === "vol")}>Vol-only</button>
        <span style={{ width: 8 }} />
        <button onClick={() => setFilter("all")} style={chip(filter === "all")}>All ({rows.length})</button>
        <button onClick={() => setFilter("pos")} style={chip(filter === "pos", HOME_THEME.green)}>Positive ({posCount})</button>
        <button onClick={() => setFilter("neg")} style={chip(filter === "neg", HOME_THEME.red)}>Negative ({negCount})</button>
        <span style={{ flex: 1 }} />
        <button onClick={load} style={chip(false)}>Refresh</button>
      </div>

      {err && (
        <div style={{ padding: 12, borderRadius: 8, background: `${HOME_THEME.red}18`, border: `1px solid ${HOME_THEME.red}55`, color: "#fff", fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!err && !loading && !view.length && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
          No rows yet — the sweep runs every 30m during RTH.
        </div>
      )}

      {!!view.length && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }} onClick={() => toggle("symbol")}>Ticker{caret("symbol")}</th>
                <th style={th} onClick={() => toggle("spot")}>Spot{caret("spot")}</th>
                <th style={{ ...th, cursor: "default" }}>Front exp</th>
                <th style={th} onClick={() => toggle("near_pct")}>Front ± GEX %{caret("near_pct")}</th>
                <th style={{ ...th, textAlign: "left", cursor: "default", width: 110 }}> </th>
                <th style={th} onClick={() => toggle("all_pct")}>All-exp ± GEX %{caret("all_pct")}</th>
                <th style={{ ...th, textAlign: "left", cursor: "default", width: 110 }}> </th>
                <th style={th} onClick={() => toggle("all_abs")}>Total |GEX|{caret("all_abs")}</th>
                <th style={{ ...th, cursor: "default" }}>Exps</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const np = nearOf(r);
                const ap = allOf(r);
                return (
                  <tr key={r.symbol} className="card-hover">
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>
                    <td style={td}>{r.spot ? r.spot.toFixed(2) : "—"}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
                      {r.near_expiry ?? "—"}{r.near_dte != null ? ` · ${r.near_dte}d` : ""}
                    </td>
                    <td style={{ ...td, color: pctColor(np), fontWeight: 700 }}>{fmtPct(np)}</td>
                    <td style={{ ...td, width: 110 }}><PctBar pct={np} /></td>
                    <td style={{ ...td, color: pctColor(ap), fontWeight: 700 }}>{fmtPct(ap)}</td>
                    <td style={{ ...td, width: 110 }}><PctBar pct={ap} /></td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.75)" }}>{fmtB(r.all_abs)}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.5)" }}>{r.exp_count ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ThemeCard>
  );
}
