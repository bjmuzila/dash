"use client";

/**
 * /strike-growth — "which strike is growing HUGE today?"
 *
 * Ranks every tracked strike across the watchlist by absolute dollar GEX added
 * since today's open snapshot (delta_abs, OI+Vol net basis). Data comes from the
 * strike-growth recorder via /proxy/strike-growth. Filter by ticker, min Δ$,
 * and call/put side; click a row to see its intraday path; edit the watchlist
 * inline. Theme is automatic via PageShell + Card (no hardcoded look).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

type Row = {
  symbol: string;
  strike: number;
  expiry: string;
  gex_now: number;
  gex_open: number;
  delta_abs: number;
  delta_pct: number | null;
  spot: number | null;
  ts: string;
  chg15: number | null;
  chg30: number | null;
  chg60: number | null;
};

type WatchRow = { symbol: string; active: boolean; sort_idx: number };
type Side = "all" | "call" | "put";
type SortKey = "symbol" | "strike" | "spot" | "expiry" | "gex_open" | "gex_now" | "delta_abs" | "delta_pct" | "chg15" | "chg30" | "chg60";

// Neutral grey accent → card has no color tint on the strip/glow.
const NEUTRAL = "#6B7280";

const fmtB = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
};

export default function StrikeGrowthPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState<string>("");

  // filters
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<Side>("all");
  const [minB, setMinB] = useState(0); // min |Δ$| in $B

  // client-side sort. default: |Δ$| desc (matches server ranking).
  const [sortKey, setSortKey] = useState<SortKey>("delta_abs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // watchlist editor
  const [watch, setWatch] = useState<WatchRow[]>([]);
  const [newSym, setNewSym] = useState("");
  const [showWatch, setShowWatch] = useState(false);

  // selected strike series
  const [sel, setSel] = useState<Row | null>(null);
  const [series, setSeries] = useState<{ ts: string; gex_now: number; delta_abs: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = new URL("/proxy/strike-growth", window.location.origin);
      if (symbol.trim()) u.searchParams.set("symbol", symbol.trim().toUpperCase());
      if (side !== "all") u.searchParams.set("type", side);
      u.searchParams.set("min", String(minB * 1e9));
      u.searchParams.set("limit", "300");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); }
      catch {
        // Non-JSON (usually an HTML 404/500 page) — surface a clean message
        // instead of "Unexpected token '<'".
        throw new Error(
          res.status === 404
            ? "Route not found — is server-v2 running and proxying /proxy/* ?"
            : `Server returned ${res.status} (non-JSON). Recorder may not have run yet.`
        );
      }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
      setDate(j.date || "");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [symbol, side, minB]);

  const loadWatch = useCallback(async () => {
    try {
      const res = await fetch("/proxy/strike-growth/watchlist", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) setWatch(j.rows || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadWatch(); }, [loadWatch]);
  // auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const openSeries = useCallback(async (r: Row) => {
    setSel(r);
    setSeries([]);
    try {
      const u = new URL("/proxy/strike-growth/series", window.location.origin);
      u.searchParams.set("symbol", r.symbol);
      u.searchParams.set("strike", String(r.strike));
      const res = await fetch(u.toString(), { cache: "no-store" });
      const j = await res.json();
      if (j.ok) setSeries(j.rows || []);
    } catch {}
  }, []);

  async function toggleWatch(sym: string, active: boolean) {
    await fetch("/proxy/strike-growth/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, active }),
    });
    loadWatch();
  }
  async function removeWatch(sym: string) {
    await fetch("/proxy/strike-growth/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, remove: true }),
    });
    loadWatch();
  }
  async function addWatch() {
    const s = newSym.trim().toUpperCase();
    if (!s) return;
    await toggleWatch(s, true);
    setNewSym("");
  }

  const maxAbs = useMemo(
    () => rows.reduce((m, r) => Math.max(m, Math.abs(r.delta_abs)), 0) || 1,
    [rows]
  );

  // Click a header to sort by it; click again to flip direction. Δ$ and Δ%
  // sort by ABSOLUTE value (biggest mover, either direction); everything else
  // sorts by raw value. Strings (symbol/expiry) sort lexically.
  function clickSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  const sortedRows = useMemo(() => {
    const useAbs = sortKey === "delta_abs" || sortKey === "delta_pct"
      || sortKey === "chg15" || sortKey === "chg30" || sortKey === "chg60";
    const val = (r: Row): number | string => {
      const v = (r as any)[sortKey];
      if (sortKey === "symbol" || sortKey === "expiry") return String(v ?? "");
      const n = Number(v ?? 0);
      return useAbs ? Math.abs(n) : n;
    };
    const dir = sortDir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return (va - vb) * dir;
    });
  }, [rows, sortKey, sortDir]);

  const SEG: { v: Side; label: string }[] = [
    { v: "all", label: "All" },
    { v: "call", label: "Calls (≥ spot)" },
    { v: "put", label: "Puts (< spot)" },
  ];

  return (
    <PageShell>
      <Card
        accent={NEUTRAL}
        title="Strike Growth Tracker"
        subtitle={date ? `Ranked by Δ$ vs open — ${date}${loading ? " · refreshing…" : ""}` : "Loading…"}
      >
        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Filter ticker (blank = all)"
            style={{ ...homeInputStyle, width: 220, textTransform: "uppercase" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {SEG.map((s) => (
              <button
                key={s.v}
                onClick={() => setSide(s.v)}
                style={segBtn(side === s.v)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.green }}>
            min Δ$
            <select
              value={minB}
              onChange={(e) => setMinB(Number(e.target.value))}
              style={{ ...homeInputStyle, width: 110 }}
            >
              <option value={0}>any</option>
              <option value={0.1}>0.1B</option>
              <option value={0.5}>0.5B</option>
              <option value={1}>1B</option>
              <option value={5}>5B</option>
            </select>
          </label>
          <button onClick={() => load()} style={segBtn(false)}>↻ Refresh</button>
          <button onClick={() => setShowWatch((v) => !v)} style={segBtn(showWatch)}>
            {showWatch ? "Hide" : "Edit"} watchlist
          </button>
        </div>

        {err && <div style={{ color: HOME_THEME.red, marginBottom: 12 }}>{err}</div>}

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: HOME_THEME.green, textAlign: "right" }}>
                <th style={thL}>#</th>
                <SortTh k="symbol"    style={thL}  cur={sortKey} dir={sortDir} on={clickSort}>Symbol</SortTh>
                <SortTh k="strike"    style={th}   cur={sortKey} dir={sortDir} on={clickSort}>Strike</SortTh>
                <SortTh k="spot"      style={th}   cur={sortKey} dir={sortDir} on={clickSort}>Spot</SortTh>
                <SortTh k="expiry"    style={thL2} cur={sortKey} dir={sortDir} on={clickSort}>Expiry</SortTh>
                <SortTh k="gex_open"  style={th}   cur={sortKey} dir={sortDir} on={clickSort}>Open GEX (OI)</SortTh>
                <SortTh k="gex_now"   style={th}   cur={sortKey} dir={sortDir} on={clickSort}>Now GEX (Vol)</SortTh>
                <SortTh k="delta_abs" style={th}   cur={sortKey} dir={sortDir} on={clickSort}>Δ$</SortTh>
                <SortTh k="delta_pct" style={th}   cur={sortKey} dir={sortDir} on={clickSort}>Δ%</SortTh>
                <SortTh k="chg15"     style={th}   cur={sortKey} dir={sortDir} on={clickSort}>15m</SortTh>
                <SortTh k="chg30"     style={th}   cur={sortKey} dir={sortDir} on={clickSort}>30m</SortTh>
                <SortTh k="chg60"     style={th}   cur={sortKey} dir={sortDir} on={clickSort}>60m</SortTh>
                <th style={thBar}>Growth</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => {
                const up = r.delta_abs >= 0;
                const col = up ? HOME_THEME.green : HOME_THEME.red;
                const w = (Math.abs(r.delta_abs) / maxAbs) * 100;
                return (
                  <tr
                    key={`${r.symbol}-${r.strike}`}
                    onClick={() => openSeries(r)}
                    style={{ cursor: "pointer", borderTop: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <td style={{ ...tdL, color: "rgba(255,255,255,0.4)" }}>{i + 1}</td>
                    <td style={{ ...tdL, fontWeight: 700 }}>{r.symbol}</td>
                    <td style={td}>{r.strike}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.55)" }}>
                      {r.spot != null ? r.spot.toFixed(2) : "—"}
                    </td>
                    <td style={tdL2}>{r.expiry}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.55)" }}>{fmtB(r.gex_open)}</td>
                    <td style={td}>{fmtB(r.gex_now)}</td>
                    <td style={{ ...td, color: col, fontWeight: 800 }}>{fmtB(r.delta_abs)}</td>
                    <td style={{ ...td, color: col }}>
                      {r.delta_pct != null ? `${r.delta_pct >= 0 ? "+" : ""}${r.delta_pct.toFixed(0)}%` : "—"}
                    </td>
                    <td style={tdBar}>
                      <div style={{ height: 8, borderRadius: 4, width: `${w}%`, minWidth: 2, background: col, opacity: 0.85 }} />
                    </td>
                  </tr>
                );
              })}
              {!rows.length && !loading && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                  No snapshots yet today. The recorder writes during RTH every 30m — or fire <code>POST /proxy/strike-growth-run</code>.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Selected strike intraday path */}
      {sel && (
        <Card accent={NEUTRAL} title={`${sel.symbol} ${sel.strike} — intraday GEX`} style={{ marginTop: 16 }}>
          <Sparkline series={series} />
          <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            open {fmtB(sel.gex_open)} → now {fmtB(sel.gex_now)} ({fmtB(sel.delta_abs)})
          </div>
        </Card>
      )}

      {/* Watchlist editor */}
      {showWatch && (
        <Card accent={NEUTRAL} title="Watchlist" subtitle="Active symbols are swept every 30m. Toggle to control Theta load." style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={newSym}
              onChange={(e) => setNewSym(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWatch()}
              placeholder="Add ticker"
              style={{ ...homeInputStyle, width: 160, textTransform: "uppercase" }}
            />
            <button onClick={addWatch} style={segBtn(false)}>+ Add</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {watch.map((w) => (
              <span
                key={w.symbol}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
                  borderRadius: 8, fontSize: 12,
                  border: `1px solid ${w.active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
                  background: w.active ? "rgba(33,158,188,0.12)" : "transparent",
                  color: w.active ? HOME_THEME.text : "rgba(255,255,255,0.5)",
                }}
              >
                <button onClick={() => toggleWatch(w.symbol, !w.active)} style={chipBtn} title="toggle active">
                  {w.symbol}
                </button>
                <button onClick={() => removeWatch(w.symbol)} style={{ ...chipBtn, color: HOME_THEME.red }} title="remove">×</button>
              </span>
            ))}
          </div>
        </Card>
      )}
    </PageShell>
  );
}

// Minimal inline SVG sparkline (no chart lib needed for a thumbnail).
function Sparkline({ series }: { series: { ts: string; gex_now: number }[] }) {
  if (series.length < 2) return <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>Not enough points yet.</div>;
  const ys = series.map((s) => s.gex_now);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const W = 600, H = 90;
  const pts = series.map((s, i) => {
    const x = (i / (series.length - 1)) * W;
    const y = H - ((s.gex_now - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = ys[ys.length - 1];
  const up = last >= ys[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 90 }}>
      <polyline points={pts} fill="none" stroke={up ? HOME_THEME.green : HOME_THEME.red} strokeWidth={2} />
    </svg>
  );
}

// Clickable sortable header cell. Shows a ▲/▼ caret on the active column.
function SortTh({
  k, cur, dir, on, style, children,
}: {
  k: SortKey; cur: SortKey; dir: "asc" | "desc";
  on: (k: SortKey) => void; style: React.CSSProperties; children: React.ReactNode;
}) {
  const active = cur === k;
  return (
    <th
      onClick={() => on(k)}
      style={{ ...style, cursor: "pointer", userSelect: "none", color: active ? HOME_THEME.cyan : undefined }}
      title="Click to sort"
    >
      {children}{active ? (dir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );
}

// ── inline style helpers ───────────────────────────────────────────────────
const th: React.CSSProperties = { padding: "6px 10px", textAlign: "right", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" };
const thL: React.CSSProperties = { ...th, textAlign: "left" };
const thL2: React.CSSProperties = { ...th, textAlign: "left" };
const thBar: React.CSSProperties = { ...th, textAlign: "left", width: 140 };
const td: React.CSSProperties = { padding: "6px 10px", textAlign: "right", color: HOME_THEME.text };
const tdL: React.CSSProperties = { ...td, textAlign: "left" };
const tdL2: React.CSSProperties = { ...td, textAlign: "left", color: "rgba(255,255,255,0.55)", fontSize: 12 };
const tdBar: React.CSSProperties = { ...td, textAlign: "left" };

function segBtn(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
    border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
    background: active ? "rgba(33,158,188,0.15)" : "transparent",
    color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
  };
}
const chipBtn: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer", color: "inherit", font: "inherit", padding: 0,
};
