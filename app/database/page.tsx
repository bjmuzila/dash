"use client";

import { useState, useEffect, useCallback } from "react";
import { useRefreshButton } from "@/hooks/useRefreshButton";
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
import { OwnerQuickLinks } from "@/components/shared/OwnerQuickLinks";

const TABLES = [
  { id: "eod_gex", label: "EOD GEX" },
  { id: "mvc_snapshots", label: "CB - Core Bullseye Snapshots" },
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

/**
 * Rows-written-today counts per tracked table. Moved here from the owner
 * dashboard's Database tab so all DB surfaces live on the backend Database page.
 * Self-contained: fetches its own per-table counts from /api/db countOnly.
 */
function RowCountsToday() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const loadCounts = useCallback(async () => {
    setLoading(true);
    const today = todayET();
    const out: Record<string, number> = {};
    await Promise.all(
      TABLES.map(async ({ id }) => {
        try {
          const r = await fetch(`/api/db?table=${id}&limit=1&date=${today}&countOnly=true`, { cache: "no-store" });
          const j = await r.json();
          out[id] = Number(j.count ?? 0);
        } catch { out[id] = 0; }
      }),
    );
    setCounts(out);
    setLoading(false);
  }, []);

  useEffect(() => { void loadCounts(); }, [loadCounts]);

  return (
    <div style={{ ...homePanelStyle, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Database · Today</span>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, fontFamily: "var(--font-mono)" }}>
          {loading ? "loading…" : `${TABLES.length} tables tracked`}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        {TABLES.map(({ id, label }) => (
          <div key={id} style={{ ...homePanelStyle, minHeight: 0, padding: "10px 14px", overflow: "hidden" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: HOME_THEME.text, opacity: 0.9, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--font-mono)", color: HOME_THEME.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {counts[id] != null ? counts[id].toLocaleString() : "—"}
            </div>
            <div style={{ fontSize: 11, color: HOME_THEME.muted, whiteSpace: "nowrap" }}>rows today</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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

/** Compact GEX formatter: +$1.23B / -$45.6M / +$789K. */
function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${(abs / 1e3).toFixed(2)}K`;
}

interface EodGexRow { symbol: string; total_gex: number; spot: number; computed_at: string }

/**
 * EOD GEX save status for today ($SPX/SPY/QQQ). Moved here from the owner
 * dashboard so all DB surfaces live on the backend Database page. The recorder
 * fires 3:55–4:05 PM ET; before that this shows "not yet recorded".
 */
function EodGexToday() {
  const [rows, setRows] = useState<EodGexRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEod = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/eod-gex?date=${todayET()}`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setRows((j.rows ?? []) as EodGexRow[]); }
    } catch { /* non-fatal */ }
    setLoading(false);
  }, []);

  useEffect(() => { void loadEod(); }, [loadEod]);

  return (
    <div style={{ ...homePanelStyle, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text, letterSpacing: "0.01em" }}>EOD GEX · Today</span>
        <span style={{ fontSize: 12, color: HOME_THEME.muted, fontFamily: "var(--font-mono)" }}>
          {loading ? "loading…" : rows.length === 0 ? "not yet recorded" : `${rows.length} symbol(s) saved`}
        </span>
      </div>
      {rows.length === 0 && !loading ? (
        <div style={{ fontSize: 12, color: HOME_THEME.muted, fontFamily: "var(--font-mono)" }}>
          Not yet recorded today — fires 3:55–4:05 PM ET
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(["$SPX", "SPY", "QQQ"] as const).map((sym) => {
            const row = rows.find((r) => r.symbol === sym);
            const ok = !!row;
            const tStr = row?.computed_at
              ? new Date(row.computed_at).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET"
              : null;
            return (
              <div key={sym} style={{
                ...homePanelStyle, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 4,
                borderLeft: `3px solid ${ok ? HOME_THEME.green : HOME_THEME.red}55`,
                background: `linear-gradient(135deg, ${ok ? HOME_THEME.green : HOME_THEME.red}14 0%, transparent 100%)`,
                minWidth: 160,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: ok ? HOME_THEME.green : HOME_THEME.red, boxShadow: `0 0 6px ${ok ? HOME_THEME.green : HOME_THEME.red}` }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: ok ? HOME_THEME.green : HOME_THEME.red, letterSpacing: "0.1em" }}>{sym}</span>
                </div>
                {row ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 500, fontFamily: "var(--font-mono)", color: HOME_THEME.text }}>{fmtGex(row.total_gex)}</div>
                    <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 0.9 }}>
                      spot {row.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    {tStr && <div style={{ fontSize: 9, color: `${HOME_THEME.green}88` }}>{tStr}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: HOME_THEME.red, fontFamily: "var(--font-mono)" }}>not saved</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

  const { trigger: refreshTrigger, label: refreshLabel, style: refreshStyle } =
    useRefreshButton(useCallback(async () => {
      await load(tab, dateFilter, limit);
    }, [load, tab, dateFilter, limit]));

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
          <OwnerQuickLinks current="/database" />
          <button onClick={refreshTrigger} style={{ ...homeButtonStyle, color: (refreshStyle.color as string) ?? (homeButtonStyle as { color?: string }).color }}>
            {refreshLabel}
          </button>
        </div>
      </div>

      <div style={homeContentStyle}>
        <EodGexToday />
        <RowCountsToday />
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
              <table style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", borderCollapse: "collapse" }}>
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
