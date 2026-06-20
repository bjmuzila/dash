"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  HOME_THEME,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "@/components/shared/homeTheme";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerStatus {
  uptime?: number;
  idleMode?: boolean;
  wsClients?: number;
  dxLinkState?: string;
  ttAuthenticated?: boolean;
  contractsSubscribed?: number;
  lastFeedAt?: number | null;
  lastError?: string | null;
  spot?: number | null;
}

interface DbStats {
  mvc_snapshots?: number;
  premium_flow?: number;
  es_candles?: number;
  trades?: number;
  greeks_ts?: number;
  playbook_feed?: number;
  [key: string]: number | undefined;
}

interface PageStatus {
  pageKey: string;
  pageLabel: string;
  lastSeen?: string;
  status?: string;
}

interface EodGexRow {
  symbol: string;
  total_gex: number;
  spot: number;
  computed_at: string;
}

interface LogLine {
  ts: number;
  msg: string;
  level: "info" | "warn" | "err" | "ok";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_LOGS = 200;

const NAV_GROUPS: { id: string; label: string; emoji: string; items: { label: string; href: string }[] }[] = [
  {
    id: "gex", label: "Gex", emoji: "📊",
    items: [
      { label: "Overview", href: "/overview" },
      { label: "Est. Move", href: "/estimated-move" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Insights", href: "/insights" },
      { label: "Confidence", href: "/confidence-score" },
    ],
  },
  {
    id: "footprint", label: "Footprint", emoji: "👣",
    items: [
      { label: "Big Orders", href: "/footprint" },
    ],
  },
  {
    id: "stock-market", label: "Stock Market", emoji: "📈",
    items: [
      { label: "Premarket", href: "/premarket" },
      { label: "Database", href: "/database" },
      { label: "Econ Calendar", href: "/economic-calendar" },
    ],
  },
  {
    id: "personal", label: "Personal", emoji: "🧑",
    items: [
      { label: "Trading", href: "/trading" },
      { label: "Budget", href: "/budget" },
    ],
  },
  {
    id: "dev", label: "Dev", emoji: "🛠️",
    items: [
      { label: "Owner", href: "/dev/owner" },
      { label: "Dev", href: "/dev" },
      { label: "Logs", href: "/logs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const TABLES: { id: string; label: string }[] = [
  { id: "eod_gex",            label: "EOD GEX" },
  { id: "mvc_snapshots",      label: "MVC Snaps" },
  { id: "premium_flow",       label: "Prem Flow" },
  { id: "greeks_ts",          label: "Greeks TS" },
  { id: "playbook_feed",      label: "Playbook" },
  { id: "es_candles",         label: "ES Candles" },
  { id: "bzila_snapshots",    label: "Bzila Snaps" },
  { id: "bzila_gex_history",  label: "Bzila GEX" },
  { id: "flow_calls",         label: "Flow Calls" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUptime(s: number): string {
  if (!s || !isFinite(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtNum(v: number | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false }) +
    "." + String(ts % 1000).padStart(3, "0");
}

function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${(abs / 1e3).toFixed(2)}K`;
}

/** "Jun 21, 09:00 (2h ago)" style for the levels last-run stamp. */
function fmtLastRun(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const ago = mins < 60 ? `${mins}m ago`
    : mins < 1440 ? `${Math.round(mins / 60)}h ago`
    : `${Math.round(mins / 1440)}d ago`;
  const stamp = d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${stamp} ET (${ago})`;
}

/** Stale if the newest levels row is older than ~8 days (a weekly cadence missed a run). */
function levelsAreStale(iso: string | null): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return true;
  return Date.now() - d.getTime() > 8 * 24 * 60 * 60 * 1000;
}

/**
 * A ticker's EM is STALE if the last publish touched its row (updated_at) but did
 * NOT refresh the em value (em_updated_at lags it, or is null). That's exactly the
 * case where the straddle failed to price this week and a zones-only push left the
 * old em in place — the /em page then shows a value that's actually carried over.
 * Tolerance: em_updated_at within 10 min of updated_at counts as fresh.
 */
function emIsStale(updatedAt: string | null, emUpdatedAt: string | null): boolean {
  if (!emUpdatedAt) return true;
  const em = new Date(emUpdatedAt).getTime();
  if (isNaN(em)) return true;
  // Older than 8 days = definitely stale regardless of the row stamp.
  if (Date.now() - em > 8 * 24 * 60 * 60 * 1000) return true;
  const up = updatedAt ? new Date(updatedAt).getTime() : NaN;
  if (!isNaN(up) && up - em > 10 * 60 * 1000) return true;
  return false;
}

/** Classify a raw WS message string as tasty or dxlink */
function classifyWsMsg(raw: string): "tasty" | "dxlink" | null {
  try {
    const j = JSON.parse(raw);
    const t = j?.type ?? j?.channel ?? "";
    // dxLink protocol messages
    if (
      t === "SETUP" || t === "AUTH_STATE" || t === "CHANNEL_OPENED" ||
      t === "FEED_CONFIG" || t === "FEED_DATA" || t === "KEEPALIVE" ||
      t === "CHANNEL_CLOSED" || t === "ERROR" ||
      String(t).startsWith("FEED") || String(t).startsWith("AUTH")
    ) return "dxlink";
    // Our server broadcast types that originate from TT REST
    if (
      t === "snapshot" || t === "gex" || t === "flow" ||
      t === "esCandles" || t === "esCandle" || t === "ttAuth" ||
      t === "tasty" || t === "chain"
    ) return "tasty";
    // Heuristic: if it has dxlink-style fields
    if (j?.channel !== undefined || j?.keepaliveTimeout !== undefined) return "dxlink";
    return "tasty"; // default unknown → tasty bucket
  } catch {
    return null; // non-JSON, skip
  }
}

/** Extract a human-readable summary from a WS message. Returns null to suppress. */
function summarizeWsMsg(raw: string): string | null {
  try {
    const j = JSON.parse(raw);
    const t = j?.type ?? j?.channel ?? "unknown";
    if (t === "FEED_DATA") {
      const events = j?.data;
      if (Array.isArray(events) && events.length > 0) {
        return `FEED_DATA [${events.length} events] sym=${events[0]?.eventSymbol ?? events[1] ?? "?"}`;
      }
      return "FEED_DATA";
    }
    if (t === "snapshot") {
      const snap = j?.data ?? j;
      const status = snap?.status ?? {};
      return `snapshot · spot=${snap?.spot ?? "?"} dxlink=${status.dxlinkConnected ?? "?"} contracts=${status.contractsSubscribed ?? "?"}`;
    }
    if (t === "esCandles") {
      const arr = j?.candles ?? j?.data ?? [];
      return `esCandles [${Array.isArray(arr) ? arr.length : "?"}]`;
    }
    if (t === "flow") {
      const arr = j?.orders ?? j?.data ?? j?.flow ?? j?.items ?? [];
      const count = Array.isArray(arr) ? arr.length : (typeof j?.count === "number" ? j.count : null);
      if (!count) return null;
      return `flow [${count} orders]`;
    }
    if (t === "AUTH_STATE") return `AUTH_STATE state=${j?.state ?? "?"}`;
    if (t === "CHANNEL_OPENED") return `CHANNEL_OPENED ch=${j?.channel ?? "?"}`;
    if (t === "KEEPALIVE") return "KEEPALIVE";
    if (t === "snapshot") return `snapshot · gexFlip=${j?.gexFlip ?? "?"} spot=${j?.spot ?? "?"}`;
    // Only show known types — return null to suppress unknown/noisy messages
    return null;
  } catch {
    return null;
  }
}

// ─── Log Box ─────────────────────────────────────────────────────────────────

function LogBox({
  title,
  accent,
  lines,
  connected,
  onClear,
}: {
  title: string;
  accent: string;
  lines: LogLine[];
  connected: boolean;
  onClear: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, autoScroll]);

  return (
    <div
      style={{
        ...homePanelStyle,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        flex: 1,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: `1px solid ${HOME_THEME.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? accent : HOME_THEME.muted,
              boxShadow: connected ? `0 0 7px ${accent}` : "none",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: accent,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: 9,
              fontFamily: "monospace",
              padding: "2px 6px",
              borderRadius: 4,
              background: `${accent}18`,
              border: `1px solid ${accent}33`,
              color: accent,
            }}
          >
            {lines.length}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            style={{
              ...homeSecondaryButtonStyle,
              fontSize: 9,
              padding: "2px 8px",
              color: autoScroll ? accent : HOME_THEME.muted,
              borderColor: autoScroll ? `${accent}44` : HOME_THEME.border,
            }}
          >
            {autoScroll ? "▼ Auto" : "⏸ Paused"}
          </button>
          <button
            onClick={onClear}
            style={{ ...homeSecondaryButtonStyle, fontSize: 9, padding: "2px 8px" }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log stream */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          fontFamily: "monospace",
          fontSize: 11,
          lineHeight: 1.55,
          padding: "6px 10px",
          scrollbarWidth: "thin",
        }}
      >
        {lines.length === 0 && (
          <div style={{ color: "#fff", padding: "8px 0" }}>
            {connected ? "Waiting for messages…" : "Connecting…"}
          </div>
        )}
        {lines.map((l, i) => {
          const color =
            l.level === "err" ? HOME_THEME.red
            : l.level === "warn" ? HOME_THEME.orange
            : l.level === "ok" ? HOME_THEME.green
            : "#c8d8e8";
          return (
            <div key={i} style={{ display: "flex", gap: 8, padding: "1px 0" }}>
              <span style={{ color: "#fff", flexShrink: 0, fontSize: 10 }}>
                {fmtTs(l.ts)}
              </span>
              <span style={{ color, wordBreak: "break-all" }}>{l.msg}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        background: ok ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.14)",
        border: `1px solid ${ok ? HOME_THEME.green : HOME_THEME.red}44`,
        color: ok ? HOME_THEME.green : HOME_THEME.red,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: ok ? HOME_THEME.green : HOME_THEME.red,
          boxShadow: ok ? `0 0 6px ${HOME_THEME.green}` : `0 0 6px ${HOME_THEME.red}`,
        }}
      />
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  accent = HOME_THEME.cyan,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div style={{
      ...homePanelStyle,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 5,
      borderLeft: `3px solid ${accent}55`,
      background: `linear-gradient(135deg, ${accent}18 0%, ${accent}06 50%, transparent 100%)`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: `${accent}99`, textTransform: "uppercase", letterSpacing: "0.14em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent, fontFamily: mono ? "monospace" : "inherit", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: 6 }}>
      {children}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OwnerDashboard() {
  const [server, setServer] = useState<ServerStatus>({});
  const [dbStats, setDbStats] = useState<DbStats>({});
  const [pageStatuses, setPageStatuses] = useState<PageStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [uptimeTick, setUptimeTick] = useState(0);
  // Levels auto-publish status (the /em customer feed). `tickers` now carries the
  // per-row em freshness so the chips can flag a STALE em (served from a prior
  // run because this week's straddle failed to price).
  const [levels, setLevels] = useState<{
    count: number;
    lastRun: string | null;
    tickers: Array<{ ticker: string; stale: boolean }>;
  }>({ count: 0, lastRun: null, tickers: [] });

  // Manual publish run state + last-run summary from /proxy/levels-status.
  const [pubRun, setPubRun] = useState<{
    running: boolean;
    at: string | null;
    reason: string | null;
    ms: number | null;
    emOk: number | null;
    emTotal: number | null;
    posted: number | null;
    failedEm: string[];
    error: string | null;
  }>({ running: false, at: null, reason: null, ms: null, emOk: null, emTotal: null, posted: null, failedEm: [], error: null });
  const [publishing, setPublishing] = useState(false);

  // EOD GEX save status (today's rows from eod_gex table)
  const [eodGex, setEodGex] = useState<EodGexRow[]>([]);

  // Levels section collapsed state
  const [levelsCollapsed, setLevelsCollapsed] = useState(true);

  // Per-ticker "Copy Pine" feedback: holds the ticker just copied (clears after 1.5s).
  const [copiedTicker, setCopiedTicker] = useState<string | null>(null);

  // Fetch the baked-in Pine v5 script for a ticker and drop it on the clipboard.
  const copyPine = useCallback(async (ticker: string) => {
    try {
      const r = await fetch(`/api/pinescript?ticker=${encodeURIComponent(ticker)}&format=json`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.pine) throw new Error(j?.error || "no script");
      await navigator.clipboard.writeText(j.pine);
      setCopiedTicker(ticker);
      setTimeout(() => setCopiedTicker((c) => (c === ticker ? null : c)), 1500);
    } catch (err) {
      window.alert(`Copy Pine failed for ${ticker}: ${String((err as Error)?.message || err)}`);
    }
  }, []);

  // Core "Estimated Moves" watchlist — the zone roster from em-tickers.js
  // (ZONE_SYMBOLS), using the display labels the table publishes (ESU/NQU).
  const CORE_EM_TICKERS = ["SPX", "NDX", "ESU", "NQU", "SPY", "QQQ", "IWM"];

  // TradingView watchlist export — the combined indicator is filtered to these
  // (intersected with tickers that actually have levels). Paste a fresh export
  // here to change the roster. ###sections and EXCHANGE: prefixes are handled.
  const WATCHLIST =
    "CME_MINI:ESU2026,CME_MINI:NQU2026,AMEX:SPY,NASDAQ:QQQ,SPCFD:SPX,NASDAQ:NDX,CBOE:UVXY," +
    "NASDAQ:AAPL,NASDAQ:AMD,NASDAQ:AMZN,NASDAQ:GOOGL,NASDAQ:META,NASDAQ:MSFT,NASDAQ:NVDA,NASDAQ:SPCX,NASDAQ:TSLA," +
    "NASDAQ:ASTS,NASDAQ:AVGO,NASDAQ:BYND,NYSE:CMG,NASDAQ:COIN,NASDAQ:NFLX,NYSE:NOK,NYSE:OSCR,NASDAQ:PLTR,NYSE:QBTS," +
    "NASDAQ:QUBT,NASDAQ:RGTI,NASDAQ:RIVN,AMEX:SLV,NASDAQ:SMCI,NASDAQ:SOFI,NASDAQ:SOUN,AMEX:SOXL,NASDAQ:TQQQ," +
    "NASDAQ:ABNB,NASDAQ:AFRM,NASDAQ:ARM,NYSE:BA,NYSE:BABA,NYSE:CCJ,NYSE:CHWY,NASDAQ:COST,NYSE:CRM,NASDAQ:CRWD," +
    "NYSE:FDX,NYSE:GS,NYSE:HIMS,NASDAQ:INTC,NASDAQ:IREN,AMEX:IWM,NYSE:LLY,NYSE:MA,NASDAQ:MARA,NYSE:MCD,NYSE:MRK," +
    "NASDAQ:MRNA,NASDAQ:MU,NYSE:NIO,NYSE:NKE,NYSE:OKLO,NASDAQ:OPEN,NYSE:OXY,NASDAQ:PDD,NYSE:PFE,NASDAQ:PTON," +
    "NYSE:RBLX,NASDAQ:RIOT,NASDAQ:RKLB,NASDAQ:ROKU,NYSE:SE,NASDAQ:SMH,NASDAQ:SNDK,NYSE:SNOW,NYSE:TGT,NYSE:TSM," +
    "NASDAQ:TTD,NYSE:U,NYSE:UNH,NYSE:UPS,NASDAQ:UPST,NYSE:V,NYSE:XPEV";

  // Copy ONE combined indicator filtered to the watchlist (single pasteable script).
  const [copyingAll, setCopyingAll] = useState(false);
  const copyAllPine = useCallback(async () => {
    if (copyingAll) return;
    setCopyingAll(true);
    try {
      const r = await fetch(`/api/pinescript?all=1&format=json&symbols=${encodeURIComponent(WATCHLIST)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.pine) throw new Error(j?.error || "no script");
      await navigator.clipboard.writeText(j.pine);
      setCopiedTicker("__ALL__");
      setTimeout(() => setCopiedTicker((c) => (c === "__ALL__" ? null : c)), 1500);
    } catch (err) {
      window.alert(`Copy combined Pine failed: ${String((err as Error)?.message || err)}`);
    } finally {
      setCopyingAll(false);
    }
  }, [copyingAll]);

  // Log state — two buckets
  const [tastyLogs, setTastyLogs] = useState<LogLine[]>([]);
  const [dxLogs, setDxLogs] = useState<LogLine[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // Live uptime + lastFeedAgo counter
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setUptimeTick((t) => t + 1); setTick((t) => t + 1); }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Data refresh ──────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
        .toISOString().slice(0, 10);

      const [idleRes, pageRes, ...tableResults] = await Promise.allSettled([
        fetch("/proxy/idle"),
        fetch("/api/db?table=page_load_status&limit=50"),
        ...TABLES.map(({ id }) =>
          fetch(`/api/db?table=${id}&limit=1&date=${today}&countOnly=true`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        ),
      ]);

      if (idleRes.status === "fulfilled" && idleRes.value.ok) {
        const j = await idleRes.value.json();
        setServer((prev) => ({
          ...prev,
          idleMode: typeof j.idle === "boolean" ? j.idle : prev.idleMode,
        }));
      }

      // DB counts — each table returns { count: N }
      const counts: DbStats = {};
      tableResults.forEach((res, i) => {
        if (res.status === "fulfilled" && res.value) {
          const id = TABLES[i].id as keyof DbStats;
          counts[id] = res.value.count ?? 0;
        }
      });
      setDbStats(counts);

      if (pageRes.status === "fulfilled" && pageRes.value.ok) {
        const j = await pageRes.value.json();
        const rows: Record<string, unknown>[] = j?.rows ?? (Array.isArray(j) ? j : []);
        setPageStatuses(rows.map((r) => ({
          pageKey: String(r.page_key ?? r.pageKey ?? ""),
          pageLabel: String(r.page_label ?? r.pageLabel ?? r.page_key ?? ""),
          lastSeen: String(r.last_loaded_at ?? r.lastLoadedAt ?? r.updated_at ?? ""),
          status: r.is_loaded ? "active" : "inactive",
        })));
      }

      // Levels publish status: GET /api/levels (all rows) → count + newest updated_at.
      try {
        const lr = await fetch("/api/levels", { cache: "no-store" });
        if (lr.ok) {
          const all = (await lr.json()) as Array<{ ticker?: string; updated_at?: string; em_updated_at?: string }>;
          if (Array.isArray(all) && all.length) {
            const lastRun = all
              .map((r) => r.updated_at)
              .filter(Boolean)
              .sort()
              .pop() ?? null;
            setLevels({
              count: all.length,
              lastRun: lastRun as string | null,
              tickers: all
                .filter((r) => r.ticker)
                .map((r) => ({
                  ticker: String(r.ticker),
                  stale: emIsStale(r.updated_at ?? null, r.em_updated_at ?? null),
                })),
            });
          } else {
            setLevels({ count: 0, lastRun: null, tickers: [] });
          }
        }
      } catch { /* non-fatal */ }

      // EOD GEX save status — today's rows
      try {
        const eg = await fetch(`/api/eod-gex?date=${today}`, { cache: "no-store" });
        if (eg.ok) {
          const j = await eg.json();
          setEodGex((j.rows ?? []) as EodGexRow[]);
        }
      } catch { /* non-fatal */ }

      // Manual-publish run summary (last run + whether one is in progress).
      try {
        const ps = await fetch("/proxy/levels-status", { cache: "no-store" });
        if (ps.ok) {
          const j = await ps.json();
          const lr = j?.lastRun ?? null;
          setPubRun({
            running: !!j?.running,
            at: lr?.at ?? null,
            reason: lr?.reason ?? null,
            ms: typeof lr?.ms === "number" ? lr.ms : null,
            emOk: typeof lr?.emOk === "number" ? lr.emOk : null,
            emTotal: typeof lr?.emTotal === "number" ? lr.emTotal : null,
            posted: typeof lr?.posted === "number" ? lr.posted : null,
            failedEm: Array.isArray(lr?.failedEm) ? lr.failedEm : [],
            error: lr?.error ?? null,
          });
        }
      } catch { /* non-fatal */ }

      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  // Kick off a manual publish, then poll status until it finishes.
  const triggerPublish = useCallback(async () => {
    if (publishing) return;
    // Double-confirm: publishing overwrites the current weekly snapshot for the
    // whole roster, so require two explicit OKs before firing.
    if (!window.confirm("Publish weekly EM levels for the ENTIRE roster now?\n\nThis overwrites this week's snapshot and takes a few minutes.")) return;
    if (!window.confirm("Are you sure? This will replace the current published levels on the customer /em page.")) return;
    setPublishing(true);
    try {
      await fetch("/proxy/levels-publish", { method: "POST" });
    } catch { /* the poll below still reflects state */ }
    // Poll /proxy/levels-status until running clears (or ~10 min safety cap).
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      try {
        const ps = await fetch("/proxy/levels-status", { cache: "no-store" });
        if (ps.ok) {
          const j = await ps.json();
          const lr = j?.lastRun ?? null;
          setPubRun({
            running: !!j?.running,
            at: lr?.at ?? null,
            reason: lr?.reason ?? null,
            ms: typeof lr?.ms === "number" ? lr.ms : null,
            emOk: typeof lr?.emOk === "number" ? lr.emOk : null,
            emTotal: typeof lr?.emTotal === "number" ? lr.emTotal : null,
            posted: typeof lr?.posted === "number" ? lr.posted : null,
            failedEm: Array.isArray(lr?.failedEm) ? lr.failedEm : [],
            error: lr?.error ?? null,
          });
          if (!j?.running) { setPublishing(false); void refresh(); return; }
        }
      } catch { /* keep polling */ }
      if (Date.now() - startedAt > 10 * 60 * 1000) { setPublishing(false); return; }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  }, [publishing, refresh]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // ── WebSocket log tap ─────────────────────────────────────────────────────

  const pushLog = useCallback((bucket: "tasty" | "dxlink", line: LogLine) => {
    if (bucket === "tasty") {
      setTastyLogs((prev) => [...prev, line].slice(-MAX_LOGS));
    } else {
      setDxLogs((prev) => [...prev, line].slice(-MAX_LOGS));
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;

    const connect = () => {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let ws: WebSocket;
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        const ts = Date.now();
        pushLog("tasty", { ts, msg: "✔ WS /ws/gex connected", level: "ok" });
        pushLog("dxlink", { ts, msg: "✔ WS /ws/gex connected (dxLink relay)", level: "ok" });
      };

      ws.onmessage = (e) => {
        const raw = String(e.data);

        // Extract server state from snapshot messages
        // WsMessage envelope: { type: 'snapshot', data: MarketSnapshot, ts: number }
        try {
          const j = JSON.parse(raw);
          if (j?.type === "snapshot") {
            // data could be nested under .data or flat (some builds differ)
            const snap = j?.data ?? j;
            const s = snap?.status ?? snap?.data?.status;
            if (s) {
              setServer((prev) => ({
                ...prev,
                ttAuthenticated: typeof s.ttAuthenticated === "boolean" ? s.ttAuthenticated : prev.ttAuthenticated,
                dxLinkState: typeof s.dxlinkConnected === "boolean"
                  ? (s.dxlinkConnected ? "CONNECTED" : "DISCONNECTED")
                  : prev.dxLinkState,
                contractsSubscribed: typeof s.contractsSubscribed === "number" ? s.contractsSubscribed : prev.contractsSubscribed,
                lastFeedAt: typeof s.lastFeedAt === "number" ? s.lastFeedAt : prev.lastFeedAt,
                lastError: s.lastError ?? prev.lastError,
                spot: typeof snap.spot === "number" ? snap.spot : (typeof snap?.data?.spot === "number" ? snap.data.spot : prev.spot),
              }));
            }
          }
        } catch { /* non-JSON fine */ }

        const bucket = classifyWsMsg(raw);
        if (!bucket) return;
        const summary = summarizeWsMsg(raw);
        if (!summary) return;
        if (bucket === "dxlink" && summary === "KEEPALIVE") return;
        const level: LogLine["level"] =
          summary.toLowerCase().includes("error") || summary.toLowerCase().includes("err") ? "err"
          : summary.toLowerCase().includes("warn") ? "warn"
          : bucket === "tasty" && (summary.startsWith("snapshot") || summary.startsWith("flow")) ? "ok"
          : "info";
        pushLog(bucket, { ts: Date.now(), msg: summary, level });
      };

      ws.onerror = () => {
        const ts = Date.now();
        pushLog("tasty", { ts, msg: "✖ WS error", level: "err" });
        pushLog("dxlink", { ts, msg: "✖ WS error", level: "err" });
        try { ws.close(); } catch { /* */ }
      };

      ws.onclose = () => {
        setWsConnected(false);
        const ts = Date.now();
        pushLog("tasty", { ts, msg: "⏸ WS disconnected — reconnecting…", level: "warn" });
        pushLog("dxlink", { ts, msg: "⏸ WS disconnected — reconnecting…", level: "warn" });
        schedule();
      };
    };

    const schedule = () => {
      if (unmountedRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 3000);
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch { /* */ } }
    };
  }, [pushLog]);

  const isServerUp = !server.idleMode;
  const dxOk = server.dxLinkState === "CONNECTED";
  const ttOk = server.ttAuthenticated === true;
  const displayUptime = server.uptime != null ? server.uptime + uptimeTick : undefined;
  const lastFeedAgo = server.lastFeedAt
    ? Math.round((Date.now() - server.lastFeedAt) / 1000)
    : null;

  return (
    <div style={homeShellStyle}>
      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.cyan }}>
            Owner Dashboard
          </span>
          <StatusBadge ok={isServerUp} label={isServerUp ? "Server Live" : "Idle"} />
          <StatusBadge ok={wsConnected} label={wsConnected ? "Proxy WS" : "Proxy WS Offline"} />
          <StatusBadge ok={dxOk} label={`dxLink Feed ${server.dxLinkState || "—"}`} />
          <StatusBadge ok={ttOk} label={`TT ${ttOk ? "Auth" : "Unauth"}`} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastRefresh && (
            <span style={{ fontSize: 10, color: "#fff", fontFamily: "monospace" }}>
              {lastRefresh.toLocaleTimeString("en-US", { hour12: false })}
            </span>
          )}
          <button onClick={refresh} disabled={loading} style={homeButtonStyle}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "clamp(14px,2vw,24px)",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* ── KPI cards ── */}
        <div>
          <SectionLabel>System</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
            <StatCard label="Server Uptime" value={displayUptime != null ? fmtUptime(displayUptime) : "—"} accent={HOME_THEME.green} mono />
            <StatCard label="Idle Mode" value={server.idleMode == null ? "—" : server.idleMode ? "ON" : "OFF"} accent={server.idleMode ? HOME_THEME.red : HOME_THEME.green} />
            <StatCard label="dxLink Feed (TT→Proxy)" value={server.dxLinkState || "—"} accent={dxOk ? HOME_THEME.green : HOME_THEME.red} mono />
            <StatCard label="TT Auth" value={server.ttAuthenticated == null ? "—" : ttOk ? "OK" : "FAIL"} accent={ttOk ? HOME_THEME.green : HOME_THEME.red} />
            <StatCard label="Contracts Sub'd" value={server.contractsSubscribed ?? "—"} accent={HOME_THEME.cyan} />
            <StatCard label="Last Feed" value={lastFeedAgo != null ? `${lastFeedAgo}s ago` : "—"} accent={lastFeedAgo != null && lastFeedAgo < 10 ? HOME_THEME.green : HOME_THEME.orange} mono />
            <StatCard label="SPX Spot" value={server.spot != null ? server.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} accent={HOME_THEME.cyan} mono />
            <StatCard label="Version" value="2026.6.19-v2" accent={HOME_THEME.purple} mono />
          </div>
        </div>

        {/* ── DB row counts ── */}
        <div>
          <SectionLabel>Database · Today</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {TABLES.map(({ id, label }, idx) => {
              const count = (dbStats as Record<string, number>)[id];
              const palette = [HOME_THEME.cyan, HOME_THEME.purple, HOME_THEME.green, HOME_THEME.orange, HOME_THEME.red, "#a78bfa"];
              const accent = palette[idx % palette.length];
              return (
                <div key={id} style={{
                  ...homePanelStyle,
                  padding: "12px 16px",
                  borderLeft: `3px solid ${accent}55`,
                  background: `linear-gradient(135deg, ${accent}18 0%, ${accent}06 50%, transparent 100%)`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: `${accent}99`, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: count == null ? "#fff" : count > 0 ? `${accent}dd` : "#fff" }}>
                    {count != null ? fmtNum(count) : "—"}
                  </div>
                  <div style={{ fontSize: 9, color: `${accent}66` }}>rows today</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── EOD GEX save status ── */}
        <div>
          <SectionLabel>EOD GEX · Today</SectionLabel>
          <div style={{ ...homePanelStyle, padding: "14px 18px" }}>
            {eodGex.length === 0 ? (
              <div style={{ fontSize: 12, color: HOME_THEME.muted, fontFamily: "monospace" }}>
                Not yet recorded today — fires 3:55–4:05 PM ET
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {(["$SPX", "SPY", "QQQ"] as const).map((sym) => {
                  const row = eodGex.find((r) => r.symbol === sym);
                  const ok = !!row;
                  const tStr = row?.computed_at
                    ? new Date(row.computed_at).toLocaleTimeString("en-US", {
                        hour12: false, hour: "2-digit", minute: "2-digit",
                        timeZone: "America/New_York",
                      }) + " ET"
                    : null;
                  return (
                    <div
                      key={sym}
                      style={{
                        ...homePanelStyle,
                        padding: "12px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        borderLeft: `3px solid ${ok ? HOME_THEME.green : HOME_THEME.red}55`,
                        background: `linear-gradient(135deg, ${ok ? HOME_THEME.green : HOME_THEME.red}14 0%, transparent 100%)`,
                        minWidth: 160,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: ok ? HOME_THEME.green : HOME_THEME.red,
                          boxShadow: ok ? `0 0 6px ${HOME_THEME.green}` : `0 0 6px ${HOME_THEME.red}`,
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 12, fontWeight: 800, color: ok ? HOME_THEME.green : HOME_THEME.red, letterSpacing: "0.1em" }}>
                          {sym}
                        </span>
                      </div>
                      {row ? (
                        <>
                          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: row.total_gex >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                            {fmtGex(row.total_gex)}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: "monospace", color: HOME_THEME.muted }}>
                            spot {row.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          {tStr && (
                            <div style={{ fontSize: 9, color: `${HOME_THEME.green}88` }}>{tStr}</div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: HOME_THEME.red, fontFamily: "monospace" }}>not saved</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Levels auto-publish (/em customer feed) ── */}
        <div style={{ ...homePanelStyle }}>
          <div
            onClick={() => setLevelsCollapsed((v) => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", cursor: "pointer", borderBottom: levelsCollapsed ? "none" : `1px solid ${HOME_THEME.border}` }}
          >
            <SectionLabel>Levels Publish · /em feed</SectionLabel>
            <span style={{ fontSize: 9, color: HOME_THEME.muted, fontWeight: 700, letterSpacing: "0.08em" }}>
              {levelsCollapsed ? "▶ EXPAND" : "▼ COLLAPSE"}
            </span>
          </div>
          {!levelsCollapsed && <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <StatusBadge
                ok={!levelsAreStale(levels.lastRun)}
                label={levels.lastRun ? (levelsAreStale(levels.lastRun) ? "Stale" : "Current") : "Never run"}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Last Published</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "monospace" }}>{fmtLastRun(levels.lastRun)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Tickers</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "monospace" }}>{levels.count}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Schedule</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: "monospace" }}>Sat ~09:00 ET</span>
              </div>
              <button
                onClick={triggerPublish}
                disabled={publishing || pubRun.running}
                title="Compute & publish weekly EM levels for the whole roster now (takes a few minutes for ~370 tickers). Overwrites the current weekly snapshot."
                style={{
                  ...homeButtonStyle,
                  padding: "6px 16px",
                  borderRadius: 8,
                  fontSize: 11,
                  marginLeft: "auto",
                  opacity: (publishing || pubRun.running) ? 0.6 : 1,
                  cursor: (publishing || pubRun.running) ? "not-allowed" : "pointer",
                }}
              >
                {(publishing || pubRun.running) ? "Publishing…" : "Publish Now"}
              </button>
              <a href="/database" style={{ ...homeSecondaryButtonStyle, padding: "6px 14px", borderRadius: 8, textDecoration: "none", fontSize: 11 }}>
                View table →
              </a>
            </div>

            {/* Last manual/weekly run result */}
            {(pubRun.running || pubRun.at) && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 11, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}` }}>
                {pubRun.running ? (
                  <span style={{ fontWeight: 800, color: HOME_THEME.cyan }}>● Running… computing levels (this can take a few minutes)</span>
                ) : (
                  <>
                    <span style={{ fontWeight: 800, color: pubRun.error ? HOME_THEME.red : HOME_THEME.green }}>
                      {pubRun.error ? "✗ Failed" : "✓ Last run OK"}
                    </span>
                    {pubRun.emTotal != null && (
                      <span style={{ color: "#fff", fontFamily: "monospace" }}>
                        EM <b style={{ color: (pubRun.failedEm.length ? HOME_THEME.orange : HOME_THEME.green) }}>{pubRun.emOk}/{pubRun.emTotal}</b>
                        {pubRun.posted != null ? <> · {pubRun.posted} rows</> : null}
                      </span>
                    )}
                    {pubRun.ms != null && <span style={{ color: HOME_THEME.muted }}>in {Math.round(pubRun.ms / 1000)}s</span>}
                    {pubRun.at && <span style={{ color: HOME_THEME.muted }}>{fmtLastRun(pubRun.at)}</span>}
                    {pubRun.reason && <span style={{ color: HOME_THEME.muted }}>({pubRun.reason})</span>}
                    {pubRun.error && <span style={{ color: HOME_THEME.red }}>{pubRun.error}</span>}
                  </>
                )}
              </div>
            )}
            {!pubRun.running && pubRun.failedEm.length > 0 && (
              <div style={{ fontSize: 10, color: HOME_THEME.orange, lineHeight: 1.5 }}>
                <b>No EM priced ({pubRun.failedEm.length}):</b> {pubRun.failedEm.join(", ")}
                <span style={{ color: HOME_THEME.muted }}> — illiquid / no quoted weekly straddle, or after-hours.</span>
              </div>
            )}
            {levels.tickers.length > 0 && (
              <>
                {levels.tickers.some((t) => t.stale) && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: HOME_THEME.orange, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: HOME_THEME.orange, display: "inline-block" }} />
                    {levels.tickers.filter((t) => t.stale).length} ticker(s) showing a STALE EM — straddle didn’t price this run; /em is serving the prior week’s value.
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => void copyAllPine()}
                    disabled={copyingAll}
                    title={`Copy ONE combined indicator for the core EM watchlist (${CORE_EM_TICKERS.join(", ")})`}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: copyingAll ? "wait" : "pointer",
                      color: copiedTicker === "__ALL__" ? HOME_THEME.green : HOME_THEME.cyan,
                      background: copiedTicker === "__ALL__" ? "rgba(34,197,94,0.14)" : "rgba(0,229,255,0.15)",
                      border: `1px solid ${copiedTicker === "__ALL__" ? HOME_THEME.green + "66" : HOME_THEME.cyan + "66"}`,
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontFamily: "monospace",
                    }}
                  >
                    {copiedTicker === "__ALL__" ? "✓ copied core" : copyingAll ? "copying…" : "⧉ Copy Core EM"}
                  </button>
                  {levels.tickers.map((t) => {
                    const copied = copiedTicker === t.ticker;
                    return (
                    <button
                      key={t.ticker}
                      type="button"
                      onClick={() => void copyPine(t.ticker)}
                      title={`Click to copy Pine script.\n${t.stale ? "EM is stale — carried over from a previous run (this week’s straddle failed to price)" : "EM freshly computed this run"}`}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: "pointer",
                        color: copied ? HOME_THEME.green : t.stale ? HOME_THEME.orange : HOME_THEME.cyan,
                        background: copied ? "rgba(34,197,94,0.14)" : t.stale ? "rgba(249,115,22,0.12)" : "rgba(0,229,255,0.08)",
                        border: `1px solid ${copied ? HOME_THEME.green + "66" : t.stale ? HOME_THEME.orange + "66" : HOME_THEME.border}`,
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontFamily: "monospace",
                      }}
                    >
                      {copied ? "✓ copied" : `${t.ticker}${t.stale ? " ⚠" : ""}`}
                    </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>}
        </div>

        {/* ── Live log boxes ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Live Logs · /ws/gex tap</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: 320 }}>
            <LogBox
              title="TastyTrade · REST + Broadcast"
              accent={HOME_THEME.cyan}
              lines={tastyLogs}
              connected={wsConnected}
              onClear={() => setTastyLogs([])}
            />
            <LogBox
              title="dxLink · Feed Events"
              accent={HOME_THEME.purple}
              lines={dxLogs}
              connected={wsConnected}
              onClear={() => setDxLogs([])}
            />
          </div>
        </div>

        {/* ── Page activity by nav group ── */}
        <div>
          <SectionLabel>Page Activity</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {NAV_GROUPS.map((group) => {
              return (
                <div key={group.id} style={{ ...homePanelStyle, overflow: "hidden" }}>
                  {/* Group header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px",
                    borderBottom: `1px solid ${HOME_THEME.border}`,
                    background: "rgba(13,17,25,0.60)",
                  }}>
                    <span style={{ fontSize: 15 }}>{group.emoji}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                      {group.label}
                    </span>
                  </div>
                  {/* Items */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {group.items.map((item, i) => {
                      const status = pageStatuses.find(
                        (p) => p.pageKey === item.href.replace(/^\//, "") || p.pageKey === item.href
                      );
                      const active = status?.status === "active";
                      const seen = status?.lastSeen;
                      return (
                        <div
                          key={item.href}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: "7px 14px",
                            borderBottom: `1px solid ${HOME_THEME.border}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                flexShrink: 0,
                                background: status ? (active ? HOME_THEME.green : HOME_THEME.muted) : "rgba(255,255,255,0.15)",
                                boxShadow: active ? `0 0 6px ${HOME_THEME.green}` : "none",
                              }}
                            />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{item.label}</span>
                            <span style={{ fontSize: 10, color: "#fff", fontFamily: "monospace" }}>{item.href}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                            {status ? (
                              <StatusBadge ok={active} label={active ? "Active" : "Inactive"} />
                            ) : (
                              <span style={{ fontSize: 10, color: "#fff" }}>no data</span>
                            )}
                            {seen && (
                              <span style={{ fontSize: 9, color: "#fff", fontFamily: "monospace" }}>
                                {new Date(seen).toLocaleTimeString("en-US", { hour12: false })}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Quick links ── */}
        <div>
          <SectionLabel>Quick Links</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              { label: "Database", href: "/database" },
              { label: "Logs", href: "/logs" },
              { label: "Dev Probe", href: "/dev" },
              { label: "Changelog", href: "/changelog" },
              { label: "Confidence", href: "/confidence-score" },
              { label: "ES Candles", href: "/es-candles" },
            ].map(({ label, href }) => (
              <a key={href} href={href} style={{ ...homeSecondaryButtonStyle, padding: "7px 16px", borderRadius: 8, textDecoration: "none", fontSize: 11 }}>
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
