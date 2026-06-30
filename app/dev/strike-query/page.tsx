"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

const FALLBACK_SYMBOLS = ["SPX", "SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMZN", "META", "MSFT", "GOOGL"];
const LIMITS = [10, 20, 50, 100] as const;
const METRICS = [
  { label: "Δ GEX 15m", value: "chg15", desc: "GEX change over the last 15 minutes" },
  { label: "Δ GEX 30m", value: "chg30", desc: "GEX change over the last 30 minutes" },
  { label: "Δ GEX 60m", value: "chg60", desc: "GEX change over the last 60 minutes" },
  { label: "GEX Now",   value: "gex_now", desc: "Current absolute GEX at this strike" },
  { label: "Delta Abs", value: "delta_abs", desc: "Absolute delta exposure at this strike" },
] as const;

type Metric = (typeof METRICS)[number]["value"];

interface Row {
  expiry: string;
  strike: number;
  gex_now: number;
  delta_abs: number;
  chg15: number | null;
  chg30: number | null;
  chg60: number | null;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  row: Row | null;
}

function fmt(v: number | null | undefined, decimals = 2) {
  if (v == null || isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(decimals);
}

function chgColor(v: number | null) {
  if (v == null) return HOME_THEME.text;
  if (v > 0) return HOME_THEME.cyan;
  if (v < 0) return HOME_THEME.red;
  return HOME_THEME.text;
}

function chgArrow(v: number | null) {
  if (v == null) return "";
  if (v > 0) return " ▲";
  if (v < 0) return " ▼";
  return "";
}

const selectStyle = {
  ...homeInputStyle,
  cursor: "pointer",
  minWidth: 110,
} as React.CSSProperties;

function RowTooltip({ tip, symbol }: { tip: TooltipState; symbol: string }) {
  if (!tip.visible || !tip.row) return null;
  const r = tip.row;
  return (
    <div
      style={{
        position: "fixed",
        left: tip.x + 14,
        top: tip.y - 8,
        zIndex: 9999,
        background: HOME_THEME.panelBgStrong ?? "rgba(13,17,25,0.97)",
        border: `1px solid ${HOME_THEME.cyan}55`,
        borderRadius: 10,
        padding: "10px 14px",
        minWidth: 210,
        pointerEvents: "none",
        boxShadow: `0 4px 24px rgba(0,0,0,0.6)`,
        fontSize: 12,
        color: HOME_THEME.text,
        lineHeight: 1.7,
      }}
    >
      <div style={{ fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 6, fontSize: 13 }}>
        {symbol} ${r.strike} · {r.expiry}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "1px 12px" }}>
        <span style={{ color: HOME_THEME.green, fontSize: 11 }}>GEX Now</span>
        <span>{fmt(r.gex_now)}</span>
        <span style={{ color: HOME_THEME.green, fontSize: 11 }}>Delta Abs</span>
        <span>{fmt(r.delta_abs)}</span>
        <span style={{ color: HOME_THEME.green, fontSize: 11 }}>Δ 15m</span>
        <span style={{ color: chgColor(r.chg15) }}>{fmt(r.chg15)}{chgArrow(r.chg15)}</span>
        <span style={{ color: HOME_THEME.green, fontSize: 11 }}>Δ 30m</span>
        <span style={{ color: chgColor(r.chg30) }}>{fmt(r.chg30)}{chgArrow(r.chg30)}</span>
        <span style={{ color: HOME_THEME.green, fontSize: 11 }}>Δ 60m</span>
        <span style={{ color: chgColor(r.chg60) }}>{fmt(r.chg60)}{chgArrow(r.chg60)}</span>
      </div>
    </div>
  );
}

export default function StrikeQueryPage() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("QQQ");
  const [customSymbol, setCustomSymbol] = useState("");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("ALL");
  const [metric, setMetric] = useState<Metric>("chg15");
  const [limit, setLimit] = useState<number>(20);
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [tip, setTip] = useState<TooltipState>({ visible: false, x: 0, y: 0, row: null });
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveSymbol = customSymbol.trim().toUpperCase() || symbol;
  const symbolList = watchlist.length > 0 ? watchlist : FALLBACK_SYMBOLS;

  // Load watchlist once on mount
  useEffect(() => {
    fetch("/proxy/strike-growth/watchlist")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const active: string[] = d.rows.filter((r: { active: boolean }) => r.active).map((r: { symbol: string }) => r.symbol).sort();
        if (active.length > 0) {
          setWatchlist(active);
          setSymbol((prev) => active.includes(prev) ? prev : active[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch all data for symbol; extract expiries from response
  const fetchData = useCallback(async () => {
    if (!effectiveSymbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/proxy/strike-growth/by-expiry?symbol=${effectiveSymbol}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "fetch failed");

      const rows: Row[] = data.rows;
      setAllRows(rows);

      const exps: string[] = [...new Set<string>(rows.map((r) => r.expiry))].sort();
      setExpiries(exps);

      // Set default expiry to nearest future on first load
      setSelectedExpiry((prev) => {
        if (prev !== "ALL" && exps.includes(prev)) return prev;
        if (prev === "ALL") return "ALL";
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
        return exps.find((e) => e > today) || exps[0] || "ALL";
      });

      setLastFetch(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [effectiveSymbol]);

  // Refetch when symbol changes
  useEffect(() => {
    setAllRows([]);
    setExpiries([]);
    setSelectedExpiry("ALL");
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSymbol]);

  // Derive displayed rows from allRows + filters (no extra fetch)
  const displayRows = (() => {
    let filtered = selectedExpiry === "ALL" ? allRows : allRows.filter((r) => r.expiry === selectedExpiry);
    filtered = [...filtered].sort((a, b) => {
      const av = a[metric] ?? 0;
      const bv = b[metric] ?? 0;
      return Math.abs(Number(bv)) - Math.abs(Number(av));
    });
    return filtered.slice(0, limit);
  })();

  const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? metric;
  const expiryLabel = selectedExpiry === "ALL" ? "All Expiries" : selectedExpiry;

  function handleMouseEnter(e: React.MouseEvent, row: Row) {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => {
      setTip({ visible: true, x: e.clientX, y: e.clientY, row });
    }, 120);
  }

  function handleMouseMove(e: React.MouseEvent) {
    setTip((prev) => prev.visible ? { ...prev, x: e.clientX, y: e.clientY } : prev);
  }

  function handleMouseLeave() {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTip({ visible: false, x: 0, y: 0, row: null });
  }

  return (
    <PageShell>
      <RowTooltip tip={tip} symbol={effectiveSymbol} />

      {/* Controls */}
      <Card accent="cyan" title="Strike GEX Query" subtitle="Top movers by expiry — sorted by GEX change or size.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>

          {/* Symbol picker — from watchlist */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: HOME_THEME.green, letterSpacing: "0.05em" }}>
              TICKER {watchlist.length > 0 ? <span style={{ color: HOME_THEME.border, fontWeight: 400 }}>({watchlist.length} watched)</span> : null}
            </label>
            <select style={{ ...selectStyle, minWidth: 120 }} value={symbol} onChange={(e) => { setSymbol(e.target.value); setCustomSymbol(""); }}>
              {symbolList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Custom symbol */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: HOME_THEME.green, letterSpacing: "0.05em" }}>OR CUSTOM</label>
            <input
              style={{ ...homeInputStyle, width: 90 }}
              placeholder="NVDA…"
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
            />
          </div>

          {/* Expiry — includes ALL */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: HOME_THEME.green, letterSpacing: "0.05em" }}>EXPIRY</label>
            <select style={{ ...selectStyle, minWidth: 130 }} value={selectedExpiry} onChange={(e) => setSelectedExpiry(e.target.value)}>
              <option value="ALL">All Expiries</option>
              {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {/* Sort metric */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: HOME_THEME.green, letterSpacing: "0.05em" }}>SORT BY</label>
            <select style={selectStyle} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* Limit */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: HOME_THEME.green, letterSpacing: "0.05em" }}>LIMIT</label>
            <select style={selectStyle} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMITS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          {/* Refresh */}
          <button
            style={{ ...homeButtonStyle, padding: "8px 20px", alignSelf: "flex-end" }}
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>

        {lastFetch && (
          <p style={{ fontSize: 11, color: HOME_THEME.border, marginTop: 8 }}>
            {lastFetch} · {effectiveSymbol} · {expiryLabel} · top {displayRows.length} by |{metricLabel}|
          </p>
        )}
      </Card>

      {/* Results */}
      {(displayRows.length > 0 || error) && (
        <Card accent="purple" title={`Results — ${effectiveSymbol} · ${expiryLabel}`} subtitle={`Sorted by |${metricLabel}| · hover a row for detail`}>
          {error ? (
            <p style={{ color: HOME_THEME.red, fontSize: 13 }}>{error}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {(selectedExpiry === "ALL" ? ["Expiry", "Strike", "GEX Now", "Δ 15m", "Δ 30m", "Δ 60m", "Delta Abs"] : ["Strike", "GEX Now", "Δ 15m", "Δ 30m", "Δ 60m", "Delta Abs"]).map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "6px 10px",
                          textAlign: "right",
                          color: HOME_THEME.cyan,
                          borderBottom: `1px solid ${HOME_THEME.border}`,
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
                    <tr
                      key={`${row.expiry}-${row.strike}-${i}`}
                      onMouseEnter={(e) => handleMouseEnter(e, row)}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                      style={{
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                        cursor: "default",
                        transition: "background 0.1s",
                      }}
                      onMouseOver={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = `${HOME_THEME.cyan}12`; }}
                      onMouseOut={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)"; }}
                    >
                      {selectedExpiry === "ALL" && (
                        <td style={{ padding: "5px 10px", textAlign: "right", color: HOME_THEME.green, fontSize: 11, whiteSpace: "nowrap" }}>
                          {row.expiry}
                        </td>
                      )}
                      <td style={{ padding: "5px 10px", textAlign: "right", color: HOME_THEME.text, fontWeight: 700 }}>
                        {row.strike}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: HOME_THEME.text }}>
                        {fmt(row.gex_now)}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: chgColor(row.chg15), fontWeight: row.chg15 ? 600 : 400 }}>
                        {fmt(row.chg15)}{chgArrow(row.chg15)}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: chgColor(row.chg30), fontWeight: row.chg30 ? 600 : 400 }}>
                        {fmt(row.chg30)}{chgArrow(row.chg30)}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: chgColor(row.chg60), fontWeight: row.chg60 ? 600 : 400 }}>
                        {fmt(row.chg60)}{chgArrow(row.chg60)}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: HOME_THEME.text }}>
                        {fmt(row.delta_abs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
}
