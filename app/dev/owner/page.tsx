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

interface RenderMetrics {
  ok?: boolean;
  bandwidth: { value: number | null; unit: string; window: string; spark?: number[] };
  memory:    { value: number | null; unit: string; window: string; spark?: number[] };
  cpu:       { value: number | null; unit: string; window: string; spark?: number[] };
  fetchedAt: string;
}

// Merge a freshly-fetched metrics payload into the previous one, keeping the last
// good value/spark for any field the new payload left null/empty. Hetzner's API
// flakes intermittently (transient 5xx / rate-limit / empty series), which used to
// blank the hosting cards "half the time". With this, a failed poll holds the last
// reading instead of wiping it; only a real reading advances `fetchedAt`.
function mergeRenderMetrics(prev: RenderMetrics | null, next: RenderMetrics): RenderMetrics {
  if (!prev) return next;
  const pick = (
    a: RenderMetrics["cpu"], b: RenderMetrics["cpu"],
  ): RenderMetrics["cpu"] => {
    const value = b.value != null ? b.value : a.value;
    const spark = b.spark && b.spark.length ? b.spark : a.spark;
    return { ...b, value, spark };
  };
  // A window switch always wins (different time horizon → different numbers),
  // even if that window's first fetch came back partial.
  const windowChanged = next.cpu.window !== prev.cpu.window;
  if (windowChanged) return next;
  const gotReal = next.ok === true || next.cpu.value != null || next.bandwidth.value != null;
  return {
    ok: next.ok,
    cpu: pick(prev.cpu, next.cpu),
    bandwidth: pick(prev.bandwidth, next.bandwidth),
    // Memory comes from /proxy/self-metrics (almost always present); still guard.
    memory: pick(prev.memory, next.memory),
    // Only advance the timestamp when we actually got fresh host data.
    fetchedAt: gotReal ? next.fetchedAt : prev.fetchedAt,
  };
}

// Cloudflare edge egress (from /api/cloudflare-metrics). Same shape conventions as
// RenderMetrics' sub-fields so the merge/display helpers carry over.
interface CfMetrics {
  ok?: boolean;
  egress: { value: number | null; unit: string; window: string; spark?: number[] };
  fetchedAt: string;
}

// Merge guard for the Cloudflare card — identical intent to mergeRenderMetrics:
// a flaky/empty CF GraphQL response holds the last good egress value instead of
// blanking the card; only a real reading advances the timestamp. Window switch wins.
function mergeCfMetrics(prev: CfMetrics | null, next: CfMetrics): CfMetrics {
  if (!prev) return next;
  if (next.egress.window !== prev.egress.window) return next;
  const gotReal = next.ok === true || next.egress.value != null;
  return {
    ok: next.ok,
    egress: {
      ...next.egress,
      value: next.egress.value != null ? next.egress.value : prev.egress.value,
      spark: next.egress.spark && next.egress.spark.length ? next.egress.spark : prev.egress.spark,
    },
    fetchedAt: gotReal ? next.fetchedAt : prev.fetchedAt,
  };
}

// Live /ws/gex outbound byte tally from /proxy/self-metrics → wsBandwidth.
interface WsBandwidth {
  clients: number;
  lastMin: Record<string, number>;   // bytes per frame type, trailing 60s
  lastMinTotal: number;              // total bytes, trailing 60s (≈ bytes/min)
  total: Record<string, number>;     // cumulative bytes per type since boot
  ts: number;
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
      { label: "Home", href: "/home" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Greeks", href: "/greeks" },
      { label: "Insights", href: "/insights" },
      { label: "Confidence", href: "/confidence-score" },
      { label: "Est. Moves FE", href: "/em" },
    ],
  },
  {
    id: "futures", label: "Futures", emoji: "📉",
    items: [
      { label: "ES Candles", href: "/es-candles" },
      { label: "Fails", href: "/fails" },
    ],
  },
  {
    id: "stock-market", label: "Stock Market", emoji: "📈",
    items: [
      { label: "Premarket", href: "/premarket" },
      { label: "Econ Calendar", href: "/economic-calendar" },
    ],
  },
  {
    id: "personal", label: "Personal", emoji: "🧑",
    items: [
      { label: "Journal", href: "/trading" },
      { label: "Budget", href: "/budget" },
      { label: "To-Do", href: "/personal/todo" },
    ],
  },
  {
    id: "admin", label: "Admin", emoji: "🛠️",
    items: [
      { label: "Owner", href: "/dev/owner" },
      { label: "Admin", href: "/dev/admin" },
      { label: "Database", href: "/database" },
      { label: "Dev", href: "/dev" },
      { label: "Est. Moves BE", href: "/estimated-move" },
      { label: "Logs", href: "/logs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const TABLES: { id: string; label: string }[] = [
  { id: "mvc_snapshots",      label: "MVC Snaps" },
  { id: "premium_flow",       label: "Prem Flow" },
  { id: "greeks_ts",          label: "Greeks TS" },
  { id: "playbook_feed",      label: "Playbook" },
  { id: "es_candles",         label: "ES Candles" },
  { id: "bzila_snapshots",    label: "Bzila Snaps" },
  { id: "flow_calls",         label: "Flow Calls" },
  { id: "eod_gex",            label: "EOD GEX" },
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
  const streamRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Scroll the log container itself — NOT scrollIntoView, which scrolls the whole
  // page so each new line yanks the viewport down to the log box.
  useEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
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
        ref={streamRef}
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

/** Tiny inline area sparkline. Scales to its container width; fixed small height. */
function Sparkline({ data, accent, height = 22 }: { data: number[]; accent: string; height?: number }) {
  if (!data || data.length < 1) return null;
  const W = 100; // viewBox width; SVG stretches to container via width:100%
  // A single point can't show a trend — draw a flat baseline so the card isn't empty.
  const series = data.length === 1 ? [data[0], data[0]] : data;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const stepX = W / (series.length - 1);
  const pts = series.map((v, i) => {
    const x = i * stepX;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${height} L0,${height} Z`;
  const gradId = `spark-${accent.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatCard({
  label,
  value,
  accent = HOME_THEME.cyan,
  mono = false,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  mono?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div style={{
      ...homePanelStyle,
      containerType: "inline-size",
      padding: "clamp(8px, 9cqw, 14px) clamp(10px, 11cqw, 18px)",
      display: "flex",
      flexDirection: "column",
      gap: 5,
      overflow: "hidden",
      borderLeft: `3px solid ${accent}55`,
      background: `linear-gradient(135deg, ${accent}18 0%, ${accent}06 50%, transparent 100%)`,
    }}>
      <div style={{ fontSize: "clamp(7px, 7cqw, 11px)", fontWeight: 800, color: `${accent}99`, textTransform: "uppercase", letterSpacing: "0.14em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </div>
      <div style={{ fontSize: "clamp(12px, 14cqw, 22px)", fontWeight: 800, color: accent, fontFamily: mono ? "monospace" : "inherit", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </div>
      {footer != null && <div style={{ marginTop: 6 }}>{footer}</div>}
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
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
  // Wall-clock time (ms) when server.uptime was last received, so we can tick the
  // displayed uptime forward without drift across snapshots.
  const uptimeBaseRef = useRef<{ uptime: number; at: number } | null>(null);
  const [dbStats, setDbStats] = useState<DbStats>({});
  // Postgres health: { ok, latencyMs } from /api/db/health (SELECT 1 probe).
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; latencyMs: number } | null>(null);
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
    emGrabbed: string | null;
    tickers: Array<{ ticker: string; stale: boolean }>;
  }>({ count: 0, lastRun: null, emGrabbed: null, tickers: [] });

  // Manual publish run state + last-run summary from /proxy/levels-status.
  const [pubRun, setPubRun] = useState<{
    running: boolean;
    at: string | null;
    reason: string | null;
    ms: number | null;
    emOk: number | null;
    emTotal: number | null;
    posted: number | null;
    failedEm: { ticker: string; reason?: string }[];
    error: string | null;
  }>({ running: false, at: null, reason: null, ms: null, emOk: null, emTotal: null, posted: null, failedEm: [], error: null });
  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // failedEm may arrive as string[] (legacy) or {ticker,reason}[]; normalize.
  const normFailedEm = (raw: unknown): { ticker: string; reason?: string }[] =>
    Array.isArray(raw)
      ? raw.map((f) => (typeof f === "string" ? { ticker: f } : (f as { ticker: string; reason?: string }))).filter((f) => f && f.ticker)
      : [];

  // EOD GEX save status (today's rows from eod_gex table)
  const [eodGex, setEodGex] = useState<EodGexRow[]>([]);

  // Render hosting metrics
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
  const [renderWindow, setRenderWindow] = useState<"live" | "weekly" | "monthly">("live");
  const [renderLoading, setRenderLoading] = useState(false);
  // Cloudflare edge egress (shares the render window selector).
  const [cfMetrics, setCfMetrics] = useState<CfMetrics | null>(null);

  // Live /ws/gex outbound bandwidth, per-frame-type (from /proxy/self-metrics).
  // This is the in-app measurement that the host-level "Bandwidth" card can't
  // give: it attributes bytes to gex vs flow vs snapshot, so the dealer can see
  // which frame is doing the talking.
  const [wsBw, setWsBw] = useState<WsBandwidth | null>(null);

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

  // ── Owner control surface ───────────────────────────────────────────────────
  // Idle mode (moved here from the sidebar cogwheel) + MVC auto on/off, plus
  // transient per-button busy/result state. Handlers are defined after refresh().
  const [isIdle, setIsIdle] = useState<boolean | null>(null);
  const [mvcAuto, setMvcAuto] = useState<boolean | null>(null);
  const [maint, setMaint] = useState<boolean | null>(null);
  const [ctlBusy, setCtlBusy] = useState<string | null>(null);
  const [ctlMsg, setCtlMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  const flashMsg = useCallback((key: string, text: string, ok: boolean) => {
    setCtlMsg({ key, text, ok });
    setTimeout(() => setCtlMsg((m) => (m?.key === key ? null : m)), 4000);
  }, []);

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

      // Postgres health probe (SELECT 1). Non-fatal: on any failure show DOWN.
      try {
        const hr = await fetch("/api/db/health", { cache: "no-store" });
        const hj = await hr.json().catch(() => null);
        setDbHealth({ ok: !!hj?.ok && hr.ok, latencyMs: Number(hj?.latencyMs ?? 0) });
      } catch {
        setDbHealth({ ok: false, latencyMs: 0 });
      }

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
            const emGrabbed = all
              .map((r) => r.em_updated_at)
              .filter(Boolean)
              .sort()
              .pop() ?? null;
            setLevels({
              count: all.length,
              lastRun: lastRun as string | null,
              emGrabbed: emGrabbed as string | null,
              tickers: all
                .filter((r) => r.ticker)
                .map((r) => ({
                  ticker: String(r.ticker),
                  stale: emIsStale(r.updated_at ?? null, r.em_updated_at ?? null),
                })),
            });
          } else {
            setLevels({ count: 0, lastRun: null, emGrabbed: null, tickers: [] });
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

      // Waitlist signup count
      try {
        const wl = await fetch("/api/waitlist/count", { cache: "no-store" });
        if (wl.ok) { const j = await wl.json(); setWaitlistCount(j?.count ?? 0); }
      } catch { /* non-fatal */ }

      // Hetzner hosting metrics (live window on general refresh). Merge so a
      // transient empty/failed Hetzner response holds the last good cards instead
      // of blanking them. Only force the window back to "live" when this call
      // actually returned host data (don't yank the user off a 7d/30d view on a
      // failed background poll).
      try {
        const rm = await fetch("/api/hetzner-metrics?window=live", { cache: "no-store" });
        if (rm.ok) {
          const next = (await rm.json()) as RenderMetrics;
          const gotReal = next.ok === true || next.cpu?.value != null || next.bandwidth?.value != null;
          setRenderMetrics((prev) => mergeRenderMetrics(prev, next));
          if (gotReal) setRenderWindow("live");
        }
      } catch { /* non-fatal */ }

      // Cloudflare edge egress (live window) — merge-don't-blank like Hetzner.
      try {
        const cf = await fetch("/api/cloudflare-metrics?window=live", { cache: "no-store" });
        if (cf.ok) {
          const next = (await cf.json()) as CfMetrics;
          setCfMetrics((prev) => mergeCfMetrics(prev, next));
        }
      } catch { /* non-fatal */ }

      // Live /ws/gex outbound bandwidth (in-app, per-frame-type).
      try {
        const sm = await fetch("/proxy/self-metrics", { cache: "no-store" });
        if (sm.ok) { const j = await sm.json(); setWsBw((j?.wsBandwidth ?? null) as WsBandwidth | null); }
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
            failedEm: normFailedEm(lr?.failedEm),
            error: lr?.error ?? null,
          });
        }
      } catch { /* non-fatal */ }

      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  // Reflect idle + mvc-auto state on mount.
  useEffect(() => {
    fetch("/proxy/idle").then(r => r.ok ? r.json() : null).then(j => {
      if (j && typeof j.idle === "boolean") setIsIdle(j.idle);
    }).catch(() => {});
    fetch("/proxy/mvc-auto").then(r => r.ok ? r.json() : null).then(j => {
      if (j && typeof j.enabled === "boolean") setMvcAuto(j.enabled);
    }).catch(() => {});
    fetch("/proxy/maintenance").then(r => r.ok ? r.json() : null).then(j => {
      if (j && typeof j.maintenance === "boolean") setMaint(j.maintenance);
    }).catch(() => {});
  }, []);

  const toggleIdle = useCallback(async () => {
    const next = !isIdle;
    setCtlBusy("idle");
    try {
      const r = await fetch("/proxy/idle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idle: next }),
      });
      const j = await r.json();
      setIsIdle(typeof j.idle === "boolean" ? j.idle : next);
      setServer((prev) => ({ ...prev, idleMode: typeof j.idle === "boolean" ? j.idle : next }));
      flashMsg("idle", next ? "Feed paused (idle ON)" : "Feed resumed (idle OFF)", true);
    } catch (e) {
      flashMsg("idle", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [isIdle, flashMsg]);

  const toggleMvcAuto = useCallback(async () => {
    const next = !mvcAuto;
    setCtlBusy("mvcAuto");
    try {
      const r = await fetch("/proxy/mvc-auto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const j = await r.json();
      setMvcAuto(typeof j.enabled === "boolean" ? j.enabled : next);
      flashMsg("mvcAuto", next ? "MVC auto-snapshot ON" : "MVC auto-snapshot OFF", true);
    } catch (e) {
      flashMsg("mvcAuto", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [mvcAuto, flashMsg]);

  const toggleMaint = useCallback(async () => {
    const next = !maint;
    // Turning ON locks out customers — confirm. Turning OFF is safe.
    if (next && !window.confirm("Enable maintenance mode?\n\nAll non-owner users will be redirected to the maintenance page until you turn it off.")) return;
    setCtlBusy("maint");
    try {
      const r = await fetch("/proxy/maintenance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const j = await r.json();
      setMaint(typeof j.maintenance === "boolean" ? j.maintenance : next);
      flashMsg("maint", next ? "Maintenance mode ON — customers locked out" : "Maintenance mode OFF — site live", true);
    } catch (e) {
      flashMsg("maint", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [maint, flashMsg]);

  const doReconnect = useCallback(async () => {
    if (!window.confirm("Reconnect the TT/dxLink feed now? Live data drops for a few seconds while it re-establishes.")) return;
    setCtlBusy("reconnect");
    try {
      const r = await fetch("/proxy/reconnect", { method: "POST" });
      const j = await r.json();
      flashMsg("reconnect", j?.ok ? "Feed reconnected" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("reconnect", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); void refresh(); }
  }, [flashMsg, refresh]);

  const doEodRun = useCallback(async () => {
    setCtlBusy("eod");
    try {
      const r = await fetch("/proxy/eod-gex-run", { method: "POST" });
      const j = await r.json();
      const saved = j?.result?.saved?.length ? j.result.saved.join(", ") : "none";
      flashMsg("eod", j?.ok ? `EOD GEX saved: ${saved}` : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("eod", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); void refresh(); }
  }, [flashMsg, refresh]);

  const doMvcSnapshot = useCallback(async () => {
    setCtlBusy("mvcSnap");
    try {
      const r = await fetch("/proxy/mvc-snapshot", { method: "POST" });
      const j = await r.json();
      flashMsg("mvcSnap", j?.ok ? `Snapshot saved · MVC ${j.strike} · SPX ${j.spot}` : `Skipped: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("mvcSnap", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); void refresh(); }
  }, [flashMsg, refresh]);

  const doRedeploy = useCallback(async () => {
    if (!window.confirm("Trigger a Render redeploy?\n\nThis rebuilds and restarts the whole service — a few minutes of downtime.")) return;
    if (!window.confirm("Are you sure? The dashboard will go offline during the rebuild.")) return;
    setCtlBusy("redeploy");
    try {
      const r = await fetch("/proxy/redeploy", { method: "POST" });
      const j = await r.json();
      flashMsg("redeploy", j?.ok ? "Redeploy triggered — check Render" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("redeploy", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); }
  }, [flashMsg]);

  const fetchRenderWindow = useCallback(async (w: "live" | "weekly" | "monthly") => {
    setRenderWindow(w);
    setRenderLoading(true);
    try {
      const [rm, cf] = await Promise.all([
        fetch(`/api/hetzner-metrics?window=${w}`, { cache: "no-store" }),
        fetch(`/api/cloudflare-metrics?window=${w}`, { cache: "no-store" }),
      ]);
      if (rm.ok) {
        const next = (await rm.json()) as RenderMetrics;
        setRenderMetrics((prev) => mergeRenderMetrics(prev, next));
      }
      if (cf.ok) {
        const next = (await cf.json()) as CfMetrics;
        setCfMetrics((prev) => mergeCfMetrics(prev, next));
      }
    } catch { /* non-fatal */ } finally {
      setRenderLoading(false);
    }
  }, []);

  // Poll /proxy/levels-status until running clears (or ~10 min cap), then run done().
  const pollPublishStatus = useCallback((done: () => void) => {
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
            failedEm: normFailedEm(lr?.failedEm),
            error: lr?.error ?? null,
          });
          if (!j?.running) { done(); void refresh(); return; }
        }
      } catch { /* keep polling */ }
      if (Date.now() - startedAt > 10 * 60 * 1000) { done(); return; }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  }, [refresh]);

  // Kick off a manual full-roster publish, then poll status until it finishes.
  const triggerPublish = useCallback(async () => {
    if (publishing || retrying) return;
    // Double-confirm: publishing overwrites the current weekly snapshot for the
    // whole roster, so require two explicit OKs before firing.
    if (!window.confirm("Publish weekly EM levels for the ENTIRE roster now?\n\nThis overwrites this week's snapshot and takes a few minutes.")) return;
    if (!window.confirm("Are you sure? This will replace the current published levels on the customer /em page.")) return;
    setPublishing(true);
    try {
      await fetch("/proxy/levels-publish", { method: "POST" });
    } catch { /* the poll below still reflects state */ }
    pollPublishStatus(() => setPublishing(false));
  }, [publishing, retrying, pollPublishStatus]);

  // Retry ONLY the not-found tickers from the last run (no full re-publish).
  const triggerRetry = useCallback(async () => {
    if (publishing || retrying) return;
    const n = pubRun.failedEm.length;
    if (!n) return;
    if (!window.confirm(`Retry the ${n} not-found ticker${n === 1 ? "" : "s"} only?\n\nRecomputes just those rows; the rest of the published roster is untouched.`)) return;
    setRetrying(true);
    try {
      await fetch("/proxy/levels-retry-failed", { method: "POST" });
    } catch { /* the poll below still reflects state */ }
    pollPublishStatus(() => setRetrying(false));
  }, [publishing, retrying, pubRun.failedEm.length, pollPublishStatus]);

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
              if (typeof s.uptime === "number") {
                uptimeBaseRef.current = { uptime: s.uptime, at: Date.now() };
              }
              setServer((prev) => ({
                ...prev,
                uptime: typeof s.uptime === "number" ? s.uptime : prev.uptime,
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
  // Re-read uptimeTick so this recomputes every second.
  void uptimeTick;
  const displayUptime = uptimeBaseRef.current
    ? uptimeBaseRef.current.uptime + Math.floor((Date.now() - uptimeBaseRef.current.at) / 1000)
    : undefined;
  const lastFeedAgo = server.lastFeedAt
    ? Math.round((Date.now() - server.lastFeedAt) / 1000)
    : null;

  // Threshold accents for the Render memory/cpu cards — shared by the value text
  // and its sparkline so the trend line matches the card's status color.
  const memMb = (renderMetrics?.memory.value ?? 0) / 1024 / 1024;
  const memAccent = memMb > 400 ? HOME_THEME.red : memMb > 200 ? HOME_THEME.orange : HOME_THEME.green;
  const cpuPct = (renderMetrics?.cpu.value ?? 0) * 100;
  const cpuAccent = cpuPct > 80 ? HOME_THEME.red : cpuPct > 40 ? HOME_THEME.orange : HOME_THEME.green;

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
          <StatusBadge ok={!!dbHealth?.ok} label={dbHealth == null ? "Postgres —" : dbHealth.ok ? "Postgres OK" : "Postgres DOWN"} />
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 10 }}>
            <StatCard label="Server Uptime" value={displayUptime != null ? fmtUptime(displayUptime) : "—"} accent={HOME_THEME.green} mono />
            <StatCard
              label="Postgres"
              value={dbHealth == null ? "—" : dbHealth.ok ? `OK · ${dbHealth.latencyMs}ms` : "DOWN"}
              accent={dbHealth == null ? HOME_THEME.cyan : dbHealth.ok ? HOME_THEME.green : HOME_THEME.red}
              mono
            />
            <StatCard label="Idle Mode" value={server.idleMode == null ? "—" : server.idleMode ? "ON" : "OFF"} accent={server.idleMode ? HOME_THEME.red : HOME_THEME.green} />
            <StatCard label="dxLink Feed (TT→Proxy)" value={server.dxLinkState || "—"} accent={dxOk ? HOME_THEME.green : HOME_THEME.red} mono />
            <StatCard label="TT Auth" value={server.ttAuthenticated == null ? "—" : ttOk ? "OK" : "FAIL"} accent={ttOk ? HOME_THEME.green : HOME_THEME.red} />
            <StatCard label="Contracts Sub'd" value={server.contractsSubscribed ?? "—"} accent={HOME_THEME.cyan} />
            <StatCard label="Last Feed" value={lastFeedAgo != null ? `${lastFeedAgo}s ago` : "—"} accent={lastFeedAgo != null && lastFeedAgo < 10 ? HOME_THEME.green : HOME_THEME.orange} mono />
            <StatCard label="SPX Spot" value={server.spot != null ? server.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} accent={HOME_THEME.cyan} mono />
            <StatCard label="Waitlist Signups" value={waitlistCount != null ? waitlistCount.toLocaleString() : "—"} accent={HOME_THEME.green} mono />
            <StatCard label="Version" value={process.env.NEXT_PUBLIC_APP_VERSION || "—"} accent={HOME_THEME.purple} mono />
          </div>
        </div>

        {/* ── Hetzner hosting + Cloudflare edge metrics ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <SectionLabel>Hosting · Hetzner + Cloudflare</SectionLabel>
            <div style={{ display: "flex", gap: 2, background: HOME_THEME.panelBg, borderRadius: 6, padding: 2 }}>
              {(["live", "weekly", "monthly"] as const).map(w => (
                <button
                  key={w}
                  onClick={() => void fetchRenderWindow(w)}
                  disabled={renderLoading}
                  style={{
                    padding: "3px 10px",
                    fontSize: 9,
                    fontWeight: 800,
                    borderRadius: 4,
                    border: "none",
                    cursor: renderLoading ? "wait" : "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    background: renderWindow === w ? "rgba(0,229,255,.15)" : "transparent",
                    color: renderWindow === w ? HOME_THEME.cyan : HOME_THEME.muted,
                  }}
                >
                  {w === "live" ? "Live" : w === "weekly" ? "7 Day" : "30 Day"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, opacity: renderLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
            <StatCard
              label={`CF Egress · ${renderWindow === "live" ? "24h" : renderWindow === "weekly" ? "7d" : "30d"}`}
              value={cfMetrics?.egress.value != null
                ? cfMetrics.egress.value < 1024
                  ? `${cfMetrics.egress.value.toFixed(1)} MB`
                  : cfMetrics.egress.value < 1024 * 1024
                    ? `${(cfMetrics.egress.value / 1024).toFixed(2)} GB`
                    : `${(cfMetrics.egress.value / 1024 / 1024).toFixed(2)} TB`
                : "—"}
              accent={HOME_THEME.orange}
              mono
              footer={<Sparkline data={cfMetrics?.egress.spark ?? []} accent={HOME_THEME.orange} />}
            />
            <StatCard
              label={`Host Net · ${renderWindow === "live" ? "1h" : renderWindow === "weekly" ? "7d" : "30d"}`}
              value={renderMetrics?.bandwidth.value != null
                ? renderMetrics.bandwidth.value < 1024
                  ? `${renderMetrics.bandwidth.value.toFixed(1)} MB`
                  : `${(renderMetrics.bandwidth.value / 1024).toFixed(2)} GB`
                : "—"}
              accent={HOME_THEME.cyan}
              mono
              footer={<Sparkline data={renderMetrics?.bandwidth.spark ?? []} accent={HOME_THEME.cyan} />}
            />
            <StatCard
              label="Memory · App RSS"
              value={renderMetrics?.memory.value != null
                ? renderMetrics.memory.value < 1024 * 1024
                  ? `${(renderMetrics.memory.value / 1024).toFixed(0)} KB`
                  : `${(renderMetrics.memory.value / 1024 / 1024).toFixed(0)} MB`
                : "—"}
              accent={memAccent}
              mono
              footer={<Sparkline data={renderMetrics?.memory.spark ?? []} accent={memAccent} />}
            />
            <StatCard
              label={`CPU · ${renderWindow === "live" ? "Latest" : renderWindow === "weekly" ? "7d Avg" : "30d Avg"}`}
              value={renderMetrics?.cpu.value != null
                ? `${(renderMetrics.cpu.value * 100).toFixed(1)}%`
                : "—"}
              accent={cpuAccent}
              mono
              footer={<Sparkline data={renderMetrics?.cpu.spark ?? []} accent={cpuAccent} />}
            />
            <div style={{ containerType: "inline-size", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px", overflow: "hidden" }}>
              <div style={{ fontSize: "clamp(7px, 6cqw, 9px)", fontWeight: 700, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>Updated</div>
              <div style={{ fontSize: "clamp(8px, 7.5cqw, 11px)", fontFamily: "monospace", color: HOME_THEME.muted, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {renderMetrics?.fetchedAt
                  ? new Date(renderMetrics.fetchedAt).toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" }) + " ET"
                  : "—"}
              </div>
            </div>
          </div>

          {/* WS outbound — in-app per-frame bandwidth (the gex-vs-flow split the
              host bandwidth card can't show). Live trailing-60s window. */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                /ws/gex Outbound · Live (last 60s)
              </div>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: HOME_THEME.muted }}>
                {wsBw ? `${wsBw.clients} client${wsBw.clients === 1 ? "" : "s"}` : "—"}
              </div>
            </div>
            {(() => {
              const fmtRate = (bytesPerMin: number) => {
                const gbHr = (bytesPerMin * 60) / 1073741824;
                if (gbHr >= 1) return `${gbHr.toFixed(2)} GB/hr`;
                const mbHr = (bytesPerMin * 60) / 1048576;
                return `${mbHr.toFixed(mbHr >= 100 ? 0 : 1)} MB/hr`;
              };
              const total = wsBw?.lastMinTotal ?? 0;
              // Frame types we care about, in display order; "other" catches the rest.
              const KNOWN = ["flow", "gex", "snapshot", "spot", "aux", "status", "esCandles"];
              const lastMin: Record<string, number> = wsBw?.lastMin ?? {};
              const entries = Object.entries(lastMin)
                .filter(([, b]) => b > 0)
                .sort((a, b) => b[1] - a[1]);
              const ACCENT: Record<string, string> = {
                flow: HOME_THEME.orange, gex: HOME_THEME.cyan, snapshot: HOME_THEME.purple,
                spot: HOME_THEME.green, aux: "#38bdf8", status: HOME_THEME.muted, esCandles: "#a78bfa",
              };
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                    <StatCard
                      label="Projected Total"
                      value={wsBw ? fmtRate(total) : "—"}
                      accent={total * 60 / 1073741824 >= 1 ? HOME_THEME.red : HOME_THEME.cyan}
                      mono
                    />
                    {["flow", "gex", "snapshot"].map((t) => (
                      <StatCard
                        key={t}
                        label={`${t === "snapshot" ? "Snapshot (connects)" : t.toUpperCase()} · proj`}
                        value={wsBw ? fmtRate(lastMin[t] ?? 0) : "—"}
                        accent={ACCENT[t] ?? HOME_THEME.muted}
                        mono
                        footer={
                          <div style={{ fontSize: 9, fontFamily: "monospace", color: HOME_THEME.muted }}>
                            {wsBw && total > 0 ? `${(((lastMin[t] ?? 0) / total) * 100).toFixed(0)}% of out` : "—"}
                          </div>
                        }
                      />
                    ))}
                  </div>
                  {/* Any extra frame types beyond the headline three. */}
                  {entries.some(([t]) => !["flow", "gex", "snapshot"].includes(t)) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      {entries.filter(([t]) => !["flow", "gex", "snapshot"].includes(t)).map(([t, b]) => (
                        <span key={t} style={{
                          fontSize: 9.5, fontFamily: "monospace", fontWeight: 700,
                          color: ACCENT[t] ?? HOME_THEME.muted,
                          border: `1px solid ${ACCENT[t] ?? HOME_THEME.muted}44`,
                          background: `${ACCENT[t] ?? HOME_THEME.muted}10`,
                          padding: "3px 8px", borderRadius: 5,
                        }}>
                          {KNOWN.includes(t) ? t : `${t}?`} {fmtRate(b)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 9.5, color: HOME_THEME.muted, marginTop: 8, lineHeight: 1.5 }}>
                    Projected from the trailing 60s × open clients. If <b style={{ color: HOME_THEME.orange }}>FLOW</b> dominates and the
                    number is high while the market is closed, the flow-tape dedupe regressed. Cross-check Cloudflare Outbound.
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* ── DB row counts ── */}
        <div>
          <SectionLabel>Database · Today</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${TABLES.length}, minmax(0, 1fr))`, gap: 10 }}>
            {TABLES.map(({ id, label }, idx) => {
              const count = (dbStats as Record<string, number>)[id];
              const palette = [HOME_THEME.cyan, HOME_THEME.purple, HOME_THEME.green, HOME_THEME.orange, HOME_THEME.red, "#a78bfa"];
              const accent = palette[idx % palette.length];
              return (
                <div key={id} style={{
                  ...homePanelStyle,
                  containerType: "inline-size",
                  padding: "clamp(7px, 8cqw, 12px) clamp(9px, 10cqw, 16px)",
                  overflow: "hidden",
                  borderLeft: `3px solid ${accent}55`,
                  background: `linear-gradient(135deg, ${accent}18 0%, ${accent}06 50%, transparent 100%)`,
                }}>
                  <div style={{ fontSize: "clamp(7px, 7.5cqw, 11px)", fontWeight: 800, color: `${accent}99`, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: "clamp(11px, 13cqw, 20px)", fontWeight: 800, fontFamily: "monospace", color: count == null ? "#fff" : count > 0 ? `${accent}dd` : "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {count != null ? fmtNum(count) : "—"}
                  </div>
                  <div style={{ fontSize: "clamp(7px, 6.5cqw, 9px)", color: `${accent}66`, whiteSpace: "nowrap" }}>rows today</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Controls ── */}
        <div>
          <SectionLabel>Controls</SectionLabel>
          <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Toggles */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              {/* Idle */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Idle Mode (feed)</span>
                <button
                  onClick={toggleIdle}
                  disabled={ctlBusy === "idle"}
                  title="Pause/resume the live TT/dxLink feed. Idle ON stops recompute, flow, OI, and candle timers."
                  style={{
                    ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 12,
                    opacity: ctlBusy === "idle" ? 0.6 : 1,
                    cursor: ctlBusy === "idle" ? "wait" : "pointer",
                    background: isIdle ? "rgba(239,68,68,0.16)" : "rgba(16,185,129,0.14)",
                    color: isIdle ? HOME_THEME.red : HOME_THEME.green,
                    border: `1px solid ${isIdle ? HOME_THEME.red : HOME_THEME.green}55`,
                  }}
                >
                  {ctlBusy === "idle" ? "…" : isIdle == null ? "—" : isIdle ? "● Idle ON — resume" : "○ Idle OFF — pause"}
                </button>
              </div>
              {/* MVC auto */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>MVC Auto (5m)</span>
                <button
                  onClick={toggleMvcAuto}
                  disabled={ctlBusy === "mvcAuto"}
                  title="Enable/disable the in-process MVC auto-collector (writes mvc_snapshots every 5m during RTH)."
                  style={{
                    ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 12,
                    opacity: ctlBusy === "mvcAuto" ? 0.6 : 1,
                    cursor: ctlBusy === "mvcAuto" ? "wait" : "pointer",
                    background: mvcAuto ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.16)",
                    color: mvcAuto ? HOME_THEME.green : HOME_THEME.red,
                    border: `1px solid ${mvcAuto ? HOME_THEME.green : HOME_THEME.red}55`,
                  }}
                >
                  {ctlBusy === "mvcAuto" ? "…" : mvcAuto == null ? "—" : mvcAuto ? "● Auto ON — disable" : "○ Auto OFF — enable"}
                </button>
              </div>
              {/* Maintenance mode */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>Maintenance</span>
                <button
                  onClick={toggleMaint}
                  disabled={ctlBusy === "maint"}
                  title="When ON, all non-owner users are redirected to the maintenance page. You (owner) keep full access."
                  style={{
                    ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 12,
                    opacity: ctlBusy === "maint" ? 0.6 : 1,
                    cursor: ctlBusy === "maint" ? "wait" : "pointer",
                    background: maint ? "rgba(239,68,68,0.16)" : "rgba(16,185,129,0.14)",
                    color: maint ? HOME_THEME.red : HOME_THEME.green,
                    border: `1px solid ${maint ? HOME_THEME.red : HOME_THEME.green}55`,
                  }}
                >
                  {ctlBusy === "maint" ? "…" : maint == null ? "—" : maint ? "● Maint ON — go live" : "○ Maint OFF — enable"}
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                onClick={doReconnect}
                disabled={ctlBusy === "reconnect"}
                title="Tear down and re-establish the TT/dxLink feed (recovers from a dropped socket or expired auth without a Render restart)."
                style={{ ...homeSecondaryButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 11, opacity: ctlBusy === "reconnect" ? 0.6 : 1, cursor: ctlBusy === "reconnect" ? "wait" : "pointer" }}
              >
                {ctlBusy === "reconnect" ? "Reconnecting…" : "↻ Reconnect Feed"}
              </button>
              <button
                onClick={doEodRun}
                disabled={ctlBusy === "eod"}
                title="Manually fire the EOD GEX recorder for $SPX/SPY/QQQ (in case the 3:55–4:05 ET window was missed)."
                style={{ ...homeSecondaryButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 11, opacity: ctlBusy === "eod" ? 0.6 : 1, cursor: ctlBusy === "eod" ? "wait" : "pointer" }}
              >
                {ctlBusy === "eod" ? "Recording…" : "▶ Run EOD GEX now"}
              </button>
              <button
                onClick={doMvcSnapshot}
                disabled={ctlBusy === "mvcSnap"}
                title="Write a single MVC snapshot right now (requires RTH + a live chain)."
                style={{ ...homeSecondaryButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 11, opacity: ctlBusy === "mvcSnap" ? 0.6 : 1, cursor: ctlBusy === "mvcSnap" ? "wait" : "pointer" }}
              >
                {ctlBusy === "mvcSnap" ? "Saving…" : "📸 MVC Snapshot now"}
              </button>
              <button
                onClick={doRedeploy}
                disabled={ctlBusy === "redeploy"}
                title="Trigger a full Render redeploy via the service deploy hook (rebuilds + restarts; a few minutes of downtime)."
                style={{
                  ...homeSecondaryButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 11,
                  marginLeft: "auto",
                  color: HOME_THEME.orange, borderColor: `${HOME_THEME.orange}55`,
                  opacity: ctlBusy === "redeploy" ? 0.6 : 1, cursor: ctlBusy === "redeploy" ? "wait" : "pointer",
                }}
              >
                {ctlBusy === "redeploy" ? "Triggering…" : "⟳ Redeploy (Render)"}
              </button>
            </div>

            {/* Result message */}
            {ctlMsg && (
              <div style={{
                fontSize: 11, fontFamily: "monospace", padding: "8px 10px", borderRadius: 8,
                background: ctlMsg.ok ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
                border: `1px solid ${ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red}44`,
                color: ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red,
              }}>
                {ctlMsg.ok ? "✓ " : "✗ "}{ctlMsg.text}
              </div>
            )}
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
                <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em" }}>EM Grabbed</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "monospace" }}>{fmtLastRun(levels.emGrabbed)}</span>
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
              <div style={{ fontSize: 10, color: HOME_THEME.orange, lineHeight: 1.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <b>No EM priced ({pubRun.failedEm.length}):</b>
                  <button
                    onClick={triggerRetry}
                    disabled={retrying || publishing}
                    style={{
                      fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 6, cursor: (retrying || publishing) ? "default" : "pointer",
                      color: (retrying || publishing) ? HOME_THEME.muted : "#000",
                      background: (retrying || publishing) ? "rgba(255,255,255,0.06)" : HOME_THEME.orange,
                      border: `1px solid ${HOME_THEME.orange}`, opacity: (retrying || publishing) ? 0.6 : 1,
                    }}
                    title="Recompute and publish ONLY these tickers — the rest of the roster is untouched."
                  >
                    {retrying ? "Retrying…" : "↻ Retry not-found only"}
                  </button>
                </div>
                {pubRun.failedEm.map((f) => (
                  <span key={f.ticker} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                    <b style={{ color: "#fff" }}>{f.ticker}</b>
                    {f.reason ? <span style={{ color: HOME_THEME.muted }}> ({f.reason})</span> : null}
                  </span>
                ))}
                <div style={{ color: HOME_THEME.muted, marginTop: 3 }}>
                  Usually illiquid / no quoted weekly straddle, or after-hours. Retry once liquidity returns.
                </div>
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
