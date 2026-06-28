"use client";

import { useState, useEffect, useCallback } from "react";
import {
  HOME_THEME,
  homeButtonStyle,
  homeContentStyle,
  homeHeaderStyle,
  homeInputStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
} from "@/components/shared/homeTheme";
import { DockCalendar } from "@/components/shared/DockToolbar";

const TABLES = [
  { id: "eod_gex", label: "EOD GEX" },
  { id: "mvc_snapshots", label: "MVC Snapshots" },
  { id: "premium_flow", label: "Premium Flow" },
  { id: "greeks_ts", label: "Greeks TS" },
  { id: "playbook_feed", label: "Playbook Feed" },
  { id: "page_load_status", label: "Page Status" },
  { id: "es_candles", label: "ES Candles" },
  { id: "bzila_snapshots", label: "Bzila Snaps" },
  { id: "flow_calls", label: "Flow Calls" },
  { id: "snapshots", label: "EM Snapshots" },
  { id: "ticker_levels", label: "Levels (/em)" },
  { id: "es_stats", label: "ES Stats" },
  { id: "trades", label: "Trades" },
  { id: "expirations_cache", label: "Exp Cache" },
] as const;

type TableId = typeof TABLES[number]["id"];

function fmtCell(v: unknown, key?: string): string {
  if (v == null) return "-";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "-";
    if (
      key === "esPrice" ||
      key === "spxPrice" ||
      key === "price" ||
      key === "underlying" ||
      key === "open" ||
      key === "high" ||
      key === "low" ||
      key === "close" ||
      key === "spot"
    ) {
      return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    if (key === "ts" || key?.includes("time")) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
    }
    return Number.isInteger(v) ? v.toString() : v.toFixed(4);
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 60) + "..." : s;
  }
  const s = String(v);
  if (/^\d{13}$/.test(s)) {
    const d = new Date(Number(s));
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return s.length > 80 ? s.slice(0, 80) + "..." : s;
}

function fmtStrikeCell(v: unknown): string {
  if (v == null) return "-";
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function todayET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

export default function DatabasePage() {
  const [tab, setTab] = useState<TableId>("eod_gex");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [dateFilter, setDateFilter] = useState<string>(todayET());
  const [limit, setLimit] = useState(200);

  const load = useCallback(async (t: TableId, date: string, lim: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ table: t, limit: String(lim) });
      if (date) params.set("date", date);
      const res = await fetch(`/api/db?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      const fetched = (json.rows ?? []) as Record<string, unknown>[];
      setRows(fetched);
      setCount(json.count ?? fetched.length);
      setCols(fetched.length ? Object.keys(fetched[0]) : []);
    } catch (e) {
      setError(String(e));
      setRows([]);
      setCount(0);
      setCols([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, dateFilter, limit);
  }, [tab, dateFilter, limit, load]);

  useEffect(() => {
    const handler = () => void load(tab, dateFilter, limit);
    window.addEventListener("db-mvc-updated", handler);
    return () => window.removeEventListener("db-mvc-updated", handler);
  }, [tab, dateFilter, limit, load]);

  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>
            Database
          </span>
          <span className="text-xs font-mono" style={{ color: HOME_THEME.muted }}>
            {loading ? "Loading..." : `${count} rows`}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: HOME_THEME.muted }}>Date:</span>
            <DockCalendar value={dateFilter} onChange={setDateFilter} />
            <button
              onClick={() => setDateFilter(todayET())}
              style={{ fontSize: 10, color: HOME_THEME.cyan, background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }}
            >
              Today
            </button>
            <button
              onClick={() => setDateFilter("")}
              style={{ fontSize: 10, color: HOME_THEME.muted, background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" }}
            >
              All
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: HOME_THEME.muted }}>Limit:</span>
            {[100, 200, 500].map((n) => (
              <button
                key={n}
                onClick={() => setLimit(n)}
                style={{
                  ...homeSecondaryButtonStyle,
                  fontSize: 10,
                  padding: "2px 7px",
                  borderRadius: 4,
                  borderColor: limit === n ? HOME_THEME.cyan : HOME_THEME.border,
                  color: limit === n ? HOME_THEME.cyan : HOME_THEME.muted,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load(tab, dateFilter, limit)} style={homeButtonStyle}>
            Refresh
          </button>
        </div>
      </div>

      <div style={homeContentStyle}>
        <div style={{ ...homePanelStyle, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div className="flex flex-shrink-0 overflow-x-auto" style={{ gap: 6, padding: 8, borderBottom: `1px solid ${HOME_THEME.border}` }}>
            {TABLES.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: "6px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    borderRadius: 8,
                    border: on ? `1px solid ${HOME_THEME.cyan}59` : `1px solid ${HOME_THEME.border}`,
                    background: on
                      ? `linear-gradient(180deg, ${HOME_THEME.cyan}2e, ${HOME_THEME.cyan}0d)`
                      : "rgba(255,255,255,0.04)",
                    color: on ? HOME_THEME.cyan : HOME_THEME.text,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    boxShadow: on ? `0 0 14px ${HOME_THEME.cyan}3a, 0 2px 8px rgba(0,0,0,0.35)` : "none",
                    transition: "background .14s, color .14s, border-color .14s",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-auto">
            {error ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs" style={{ color: HOME_THEME.red }}>
                <div>{error}</div>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center h-40 text-xs" style={{ color: HOME_THEME.muted }}>Loading...</div>
            ) : cols.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-1 text-xs" style={{ color: HOME_THEME.muted }}>
                <div>No data in <strong>{tab}</strong></div>
                {dateFilter && <div style={{ fontSize: 10 }}>Try clearing the date filter (All)</div>}
              </div>
            ) : (
              <table style={{ width: "100%", fontSize: 11, fontFamily: "monospace", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "rgba(13,17,25,0.88)", position: "sticky", top: 0, zIndex: 1, backdropFilter: "blur(16px)" }}>
                    {cols.map((c) => (
                      <th
                        key={c}
                        style={{
                          padding: "8px 10px",
                          textAlign: "left",
                          borderBottom: `1px solid ${HOME_THEME.border}`,
                          color: HOME_THEME.muted,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          fontSize: 9,
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: `1px solid ${HOME_THEME.border}`,
                        background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.02)",
                      }}
                    >
                      {cols.map((c) => {
                        const v = row[c];
                        const isStrike = c.toLowerCase().includes("strike");
                        const n = typeof v === "number";
                        const neg = n && v < 0;
                        const pos = n && v > 0;
                        return (
                          <td
                            key={c}
                            style={{
                              padding: "6px 10px",
                              whiteSpace: "nowrap",
                              color: neg ? HOME_THEME.red : pos ? HOME_THEME.text : HOME_THEME.muted,
                              textAlign: n ? "right" : "left",
                              maxWidth: 220,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {isStrike ? fmtStrikeCell(v) : fmtCell(v, c)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
