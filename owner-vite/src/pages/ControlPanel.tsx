

import React, { useEffect, useRef, useState, useCallback, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { useRefreshButton } from "../hooks/useRefreshButton";
import {
  OWNER_THEME as HOME_THEME,
  homeButtonStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";

// ─── Responsive ───────────────────────────────────────────────────────────────
// Mobile detection so the fixed-column grids below can collapse instead of
// overflowing the viewport (the shell clips overflow, so wide grids = cut-off cards).
function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

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
  totalLoads?: number;
}

interface RenderMetrics {
  ok?: boolean;
  bandwidth: { value: number | null; unit: string; window: string; spark?: number[] };
  memory:    { value: number | null; unit: string; window: string; spark?: number[] };
  cpu:       { value: number | null; unit: string; window: string; spark?: number[] };
  fetchedAt: string;
  // True when HETZNER_API_TOKEN/SERVER_ID are missing (Host Net + CPU can't load).
  unconfigured?: boolean;
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
    unconfigured: next.unconfigured,
  };
}

// Cloudflare edge egress (from /api/cloudflare-metrics). Same shape conventions as
// RenderMetrics' sub-fields so the merge/display helpers carry over.
interface CfMetrics {
  ok?: boolean;
  egress: { value: number | null; unit: string; window: string; spark?: number[] };
  fetchedAt: string;
  // True when the route reports missing CLOUDFLARE_API_TOKEN/ZONE_ID — lets the
  // card show an explicit "Setup needed" state instead of a silent "—" (which is
  // indistinguishable from a transient GraphQL failure).
  unconfigured?: boolean;
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
    unconfigured: next.unconfigured,
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

// Auth status (from /api/auth-status, backed by our own users/sessions tables). The route
// reports whether Supabase auth env is configured + read-only user stats via the
// service-role admin API. Never carries secrets. (Clerk was removed; the
// publishable/secret/roleSets fields are gone — Supabase has no equivalent
// client/secret key pair surfaced here.)
interface AuthStatus {
  configured: boolean;
  provider?: string;
  environment: "test" | "live" | "unknown";
  mismatch?: boolean;
  // Read-only admin-API stats (null when unavailable).
  stats?: {
    userCount: number | null;
    activeSessions: number | null;
    recent: Array<{ id: string; email: string | null; name: string | null; createdAt: number | null }>;
  };
  // Top-level error string from the route when the admin API didn't answer.
  statsError?: string | null;
}

// One logged page load (from /api/page-visits). Owner-only; includes client IP.
interface PageVisit {
  id?: number;
  pageKey: string | null;
  pageLabel: string | null;
  path: string | null;
  userId: string | null;
  ip: string | null;
  createdAt: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NAV_GROUPS: { id: string; label: string; emoji: string; items: { label: string; href: string }[] }[] = [
  {
    id: "gex", label: "Gex", emoji: "📊",
    items: [
      { label: "Home", href: "/home" },
      { label: "Multi Greek", href: "/mult-greek" },
      { label: "Options Chain", href: "/options-chain" },
      { label: "Greeks", href: "/greeks" },
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
      { label: "Budget", href: "/owner/budget" },
      { label: "To-Do", href: "/owner/personal/todo" },
    ],
  },
  {
    id: "admin", label: "Admin", emoji: "🛠️",
    items: [
      { label: "Owner", href: "/owner/dev/owner" },
      { label: "Admin", href: "/owner/dev/admin" },
      { label: "Database", href: "/database" },
      { label: "Dev", href: "/owner/dev" },
      { label: "Est. Moves BE", href: "/estimated-move" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const TABLES: { id: string; label: string }[] = [
  { id: "mvc_snapshots",      label: "CB Snaps" },
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

/** Short "12s / 4m / 2h / 3d ago" relative stamp for the activity feed. */
function fmtAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.01em",
        background: ok ? `${HOME_THEME.green}1f` : `${HOME_THEME.red}1f`,
        border: `1px solid ${ok ? HOME_THEME.green + "55" : HOME_THEME.red + "55"}`,
        color: ok ? HOME_THEME.green : HOME_THEME.red,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: ok ? HOME_THEME.green : HOME_THEME.red,
        }}
      />
      {label}
    </span>
  );
}

/** Given a window duration ending at `endIso`, format [start, end] axis labels.
 *  Sub-day windows show ET clock time; multi-day windows show month/day. */
function sparkTimeLabels(durationMs: number, endIso?: string | null): [string, string] {
  if (!endIso) return ["", ""];
  const end = new Date(endIso);
  if (isNaN(end.getTime())) return ["", ""];
  const start = new Date(end.getTime() - durationMs);
  const daily = durationMs > 36 * 3_600_000; // > 36h → date labels read better than clock time
  const fmt = (d: Date) => daily
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
  return [fmt(start), fmt(end)];
}

/** Tiny inline area sparkline. Scales to its container width; fixed small height.
 *  Pass `axisLabels` (from sparkTimeLabels) to print start/end time under the line.
 *  Pass `durationMs` + `endIso` (same values fed to sparkTimeLabels) to enable a
 *  hover tooltip showing each point's real timestamp + value. `formatValue` controls
 *  how the raw number in that tooltip is displayed (defaults to 2-decimal). */
function Sparkline({
  data, accent, height = 22, axisLabels, durationMs, endIso, formatValue,
}: {
  data: number[]; accent: string; height?: number; axisLabels?: [string, string];
  durationMs?: number; endIso?: string | null; formatValue?: (v: number) => string;
}) {
  const [hoverI, setHoverI] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
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

  const canHover = series.length > 1;
  const hoverTime = (i: number): string => {
    if (!durationMs || !endIso) return "";
    const end = new Date(endIso).getTime();
    if (isNaN(end)) return "";
    const t = end - durationMs + (i / (series.length - 1)) * durationMs;
    const d = new Date(t);
    return durationMs > 36 * 3_600_000
      ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false, timeZone: "America/New_York" })
      : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" }) + " ET";
  };
  const handleMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!canHover || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverI(Math.round(frac * (series.length - 1)));
  };

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block", cursor: canHover ? "crosshair" : "default" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverI(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hoverI != null && (
          <>
            <line x1={pts[hoverI][0]} y1={0} x2={pts[hoverI][0]} y2={height} stroke={accent} strokeWidth="0.6" strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />
            <circle cx={pts[hoverI][0]} cy={pts[hoverI][1]} r={2.2} fill={accent} stroke="#0d1119" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hoverI != null && (
        <div
          style={{
            position: "absolute",
            bottom: `calc(100% + 4px)`,
            left: `${(pts[hoverI][0] / W) * 100}%`,
            transform: `translateX(${hoverI === 0 ? "0%" : hoverI === series.length - 1 ? "-100%" : "-50%"})`,
            background: "#0d1119",
            border: `1px solid ${accent}66`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 14,
            fontFamily: "var(--font-mono)",
            color: "#fff",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 10,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontWeight: 700, color: accent }}>{(formatValue ?? ((v: number) => v.toFixed(2)))(series[hoverI])}</div>
          {hoverTime(hoverI) && <div style={{ opacity: 0.7, marginTop: 1 }}>{hoverTime(hoverI)}</div>}
        </div>
      )}
      {axisLabels && (axisLabels[0] || axisLabels[1]) && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 14, fontFamily: "var(--font-mono)", color: "#fff", opacity: 1, lineHeight: 1 }}>
          <span>{axisLabels[0]}</span>
          <span>{axisLabels[1]}</span>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent: _accent = HOME_THEME.cyan,
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
      minHeight: 0,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, opacity: 1, letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, fontFamily: mono ? "monospace" : "inherit", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </div>
      {footer != null && <div style={{ marginTop: 6 }}>{footer}</div>}
    </div>
  );
}


/**
 * Live SPX index-feed health. Polls /proxy/status every 5s and reads spotAgeMs
 * (how long since the Theta index stream last moved spot). A frozen feed was
 * silently recording thousands of dead-spot rows into greeks_ts; this surfaces it.
 *   < 20s  → HEALTHY (green)   feed ticking
 *   20–120s → SLOW (amber)     lagging
 *   > 120s / never → STALE (red)  index stream frozen — needs a Theta re-subscribe
 */
function SpotFeedHealth() {
  const [ageMs, setAgeMs] = useState<number | null | undefined>(undefined);
  const [spot, setSpot] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/proxy/status", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setAgeMs(j?.spotAgeMs ?? null);
        setSpot(Number(j?.spot) || null);
      } catch { if (alive) setAgeMs(null); }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const stale = ageMs == null || ageMs > 120_000;
  const slow = !stale && ageMs != null && ageMs > 20_000;
  const color = stale ? HOME_THEME.red : slow ? "#facc15" : "#00e676";
  const label = ageMs === undefined ? "…" : stale ? "STALE" : slow ? "SLOW" : "HEALTHY";
  const ageStr = ageMs == null ? "no ticks" : ageMs < 1000 ? "<1s ago" : `${Math.round(ageMs / 1000)}s ago`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
      borderRadius: 12, border: `1px solid ${color}59`, background: `${color}12`,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color }}>SPX Index Feed · {label}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>
          spot {spot != null ? spot.toFixed(2) : "--"} · updated {ageStr}
        </div>
      </div>
      {stale && ageMs !== undefined && (
        <div style={{ marginLeft: "auto", fontSize: 14, color: HOME_THEME.red, opacity: 1, maxWidth: 220, textAlign: "right" }}>
          Index stream frozen — re-subscribe Theta / recreate dashboard.
        </div>
      )}
    </div>
  );
}

type ThetaStatsResp = {
  ok: boolean;
  cpuPercent?: number | null;
  memUsageBytes?: number | null;
  memLimitBytes?: number | null;
  memPercent?: number | null;
  pids?: number | null;
  status?: string;
  health?: string | null;
  restarting?: boolean;
  oomKilled?: boolean;
};

const MIB = 1024 * 1024;

// Live docker-stats readout for the theta-terminal container. Added after the
// 2026-07-07 heap OOM (options prints stopped mid-session, JVM heap exhausted
// — see docker-compose.yml theta-terminal comment) so a recurrence shows up
// here before it silently kills the feed again. Sources /api/owner/theta-stats,
// which reads the docker-socket-proxy sidecar (no raw docker.sock in the app
// container).
function ThetaTerminalStats() {
  const [data, setData] = useState<ThetaStatsResp | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/owner/theta-stats", { cache: "no-store" });
        const j = await r.json();
        if (alive) setData(r.ok ? j : null);
      } catch { if (alive) setData(null); }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const errored = data === null;
  const memPct = data?.memPercent ?? null;
  const unhealthy =
    !errored && data != null &&
    (data.status !== "running" || data.restarting || data.oomKilled || data.health === "unhealthy" || (memPct != null && memPct > 95));
  const warn = !errored && !unhealthy && ((memPct != null && memPct > 80) || data?.health === "starting");

  const color = errored || unhealthy ? HOME_THEME.red : warn ? "#facc15" : "#00e676";
  const label = data === undefined ? "…" : errored ? "UNREACHABLE" : unhealthy ? "UNHEALTHY" : warn ? "WARN" : "HEALTHY";

  const memStr = data?.memUsageBytes != null && data?.memLimitBytes
    ? `${(data.memUsageBytes / MIB).toFixed(0)}MiB / ${(data.memLimitBytes / MIB / 1024).toFixed(1)}GiB (${memPct?.toFixed(0)}%)`
    : "--";
  const cpuStr = data?.cpuPercent != null ? `${data.cpuPercent.toFixed(1)}%` : "--";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
      borderRadius: 12, border: `1px solid ${color}59`, background: `${color}12`,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color }}>Theta Terminal · {label}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>
          cpu {cpuStr} · mem {memStr} · pids {data?.pids ?? "--"}
        </div>
      </div>
      {errored && (
        <div style={{ marginLeft: "auto", fontSize: 14, color: HOME_THEME.red, opacity: 1, maxWidth: 220, textAlign: "right" }}>
          Stats unreachable — check docker-proxy sidecar.
        </div>
      )}
    </div>
  );
}

// Maps each accordion section to its sidebar nav key.
const SECTION_TAB = {
  system:   "infra",
  hosting:  "infra",
  // Controls moved under the Infra tab (its own tab was removed).
  controls: "infra",
} as const;

interface FeedbackItem {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  category: string;
  message: string;
  page: string | null;
  status: string;
  created_at: string | null;
}

/**
 * Collapsible section card for the owner dashboard. The whole header is the
 * click target; each card toggles independently (multi-open via the parent's
 * `openSet`), and all cards start expanded on load. `subtitle` shows an
 * at-a-glance summary on the collapsed header so the card is useful when closed.
 */
function AccordionCard({
  id, title, subtitle, open, onToggle, children, accent = HOME_THEME.cyan,
}: {
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  accent?: string;
}) {
  void open; void onToggle; void id; void accent;
  return (
    <div style={{ ...homePanelStyle, overflow: "visible", background: "transparent" }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "12px 16px",
          borderBottom: `1px solid ${HOME_THEME.border}`,
          background: "transparent",
          borderTopLeftRadius: 10, borderTopRightRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{ width: 3, height: 14, borderRadius: 2, background: HOME_THEME.border, flexShrink: 0 }} />
          <span style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>
            {title}
          </span>
          {subtitle != null && (
            <span style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}


// Ticker visit tracker — ranks tickers by how often they've been opened
// (click) on a given surface, from the ticker_events log via GET
// /api/ticker-event?source=... Self-contained (own fetch) so it can drop into
// the Activity section without touching the parent's state. Shared between
// the Flow and Estimated Moves visit cards below (source scopes each one).
function TickerVisitsCard({ source, icon, label }: { source: string; icon: string; label: string }) {
  const [rows, setRows] = useState<{ ticker: string; clicks: number; renders: number }[] | null>(null);
  const [days, setDays] = useState<number>(7);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null); setErr(null);
    fetch(`/api/ticker-event?sinceDays=${days}&source=${encodeURIComponent(source)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setRows((j.rows as typeof rows) ?? []); })
      .catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [days, source]);

  const ranked = (rows ?? []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 20);
  const max = ranked.length ? Math.max(...ranked.map((r) => r.clicks), 1) : 1;

  return (
    <div style={{ ...homePanelStyle, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${HOME_THEME.border}`, background: "rgba(13,17,25,0.60)" }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 17, fontWeight: 600, color: HOME_THEME.text, letterSpacing: "0.01em" }}>{label}</span>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: "4px 10px", fontSize: 14, borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${days === d ? HOME_THEME.cyan : HOME_THEME.border}`,
                background: days === d ? `${HOME_THEME.cyan}18` : "transparent",
                color: days === d ? HOME_THEME.cyan : HOME_THEME.text,
              }}
            >
              {d === 1 ? "24h" : `${d}d`}
            </button>
          ))}
        </div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {err ? (
          <div style={{ fontSize: 14, color: HOME_THEME.red }}>{err}</div>
        ) : rows == null ? (
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>Loading…</div>
        ) : ranked.length === 0 ? (
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>No ticker visits recorded in this window.</div>
        ) : ranked.map((r, i) => (
          <div key={r.ticker} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 0.5, width: 18, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.text, width: 70, flexShrink: 0 }}>{r.ticker}</span>
            <div style={{ flex: 1, height: 9, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((r.clicks / max) * 100)}%`, background: HOME_THEME.cyan, borderRadius: 5 }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.cyan, width: 54, textAlign: "right", flexShrink: 0 }}>{r.clicks.toLocaleString()}</span>
            <span title="impressions" style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 0.45, width: 60, textAlign: "right", flexShrink: 0 }}>{r.renders.toLocaleString()} imp</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Real-data bucketing for the Overview tab ────────────────────────────────

const ET_TZ = "America/New_York";

/** YYYY-MM-DD in ET for a Date (so day buckets line up with the trading day). */
function etDayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: ET_TZ }); // en-CA → ISO-ish YYYY-MM-DD
}

/** "Mon 23" style short label for a day-bucket axis tick. */
function etDayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: ET_TZ, weekday: "short", day: "numeric" });
}

/**
 * Bucket page-visit timestamps into the last `days` calendar days (ET), oldest
 * → newest. Returns parallel { counts, labels } arrays so the line chart can plot
 * real traffic instead of placeholder noise.
 */
function dailyVisitSeries(visits: PageVisit[], days = 12): { counts: number[]; labels: string[] } {
  const byDay = new Map<string, number>();
  for (const v of visits) {
    if (!v.createdAt) continue;
    const t = new Date(v.createdAt);
    if (isNaN(t.getTime())) continue;
    const k = etDayKey(t);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const counts: number[] = [];
  const labels: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    counts.push(byDay.get(etDayKey(d)) ?? 0);
    labels.push(etDayLabel(d));
  }
  return { counts, labels };
}

/**
 * Bucket page-visit timestamps into a 7×24 grid of counts — weekday (Mon..Sun,
 * ET) × hour-of-day (ET, 0-23). Powers the Overview tab's "Hourly load
 * heatmap" from real page_visits rows instead of the placeholder sample.
 * Returns { grid, max } where grid[weekdayIdx][hour] = visit count.
 */
const HEATMAP_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const heatmapPartsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  weekday: "short",
  hour: "numeric",
  hour12: false,
});
function hourlyHeatmap(visits: PageVisit[]): { grid: number[][]; max: number } {
  const grid: number[][] = HEATMAP_WEEKDAYS.map(() => Array(24).fill(0));
  const weekdayIdx: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  for (const v of visits) {
    if (!v.createdAt) continue;
    const t = new Date(v.createdAt);
    if (isNaN(t.getTime())) continue;
    const parts = heatmapPartsFmt.formatToParts(t);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    let hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    if (hour === 24) hour = 0; // some locales format midnight as "24"
    const di = weekdayIdx[weekday];
    if (di == null || isNaN(hour) || hour < 0 || hour > 23) continue;
    grid[di][hour] += 1;
  }
  const max = Math.max(1, ...grid.flat());
  return { grid, max };
}

/**
 * Bucket signups (Clerk recent users, by createdAt ms) into the last `days`
 * calendar days (ET), oldest → newest. Same shape as dailyVisitSeries so the
 * rolling-7-day cumulative-users chart can share its rendering.
 */
function dailySignupSeries(signups: Array<{ createdAt: number | null }>, days = 7): { counts: number[]; labels: string[] } {
  const byDay = new Map<string, number>();
  for (const s of signups) {
    if (s.createdAt == null) continue;
    const t = new Date(s.createdAt);
    if (isNaN(t.getTime())) continue;
    const k = etDayKey(t);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const counts: number[] = [];
  const labels: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    counts.push(byDay.get(etDayKey(d)) ?? 0);
    labels.push(etDayLabel(d));
  }
  return { counts, labels };
}

/**
 * Bucket signups (Clerk recent users, by createdAt ms) into the last `weeks`
 * ISO-ish weeks, oldest → newest. Falls back to an all-zero series the chart can
 * still render. Returns { counts, labels } with "DD Mon" week-start labels.
 */
function weeklySignupSeries(
  signups: Array<{ createdAt: number | null }>,
  weeks = 7,
): { counts: number[]; labels: string[] } {
  const now = new Date();
  // Start of the current week bucket (Monday 00:00 local is fine for grouping).
  const dayMs = 86400000;
  const weekMs = 7 * dayMs;
  const monday = new Date(now);
  const dow = (monday.getDay() + 6) % 7; // 0 = Monday
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);
  const counts: number[] = new Array(weeks).fill(0);
  const labels: string[] = [];
  const starts: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = monday.getTime() - i * weekMs;
    starts.push(start);
    labels.push(new Date(start).toLocaleDateString("en-US", { day: "numeric", month: "short" }));
  }
  for (const s of signups) {
    if (s.createdAt == null) continue;
    const t = s.createdAt;
    for (let b = 0; b < starts.length; b++) {
      if (t >= starts[b] && t < starts[b] + weekMs) { counts[b]++; break; }
    }
  }
  return { counts, labels };
}

/**
 * Bucket page-visit timestamps into the last `weeks` calendar weeks (ET), oldest
 * → newest. Returns { counts, labels } arrays for the line chart.
 */
function weeklyVisitSeries(visits: PageVisit[], weeks = 12): { counts: number[]; labels: string[] } {
  const now = new Date();
  const dayMs = 86400000;
  const weekMs = 7 * dayMs;
  const monday = new Date(now);
  const dow = (monday.getDay() + 6) % 7; // 0 = Monday
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);

  const byWeek = new Map<number, number>();
  for (const v of visits) {
    if (!v.createdAt) continue;
    const t = new Date(v.createdAt);
    if (isNaN(t.getTime())) continue;
    const weekStart = new Date(t);
    weekStart.setHours(0, 0, 0, 0);
    const d = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - d);
    const k = weekStart.getTime();
    byWeek.set(k, (byWeek.get(k) ?? 0) + 1);
  }

  const counts: number[] = [];
  const labels: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = monday.getTime() - i * weekMs;
    counts.push(byWeek.get(start) ?? 0);
    labels.push(new Date(start).toLocaleDateString("en-US", { day: "numeric", month: "short" }));
  }
  return { counts, labels };
}

/**
 * Bucket page-visit timestamps into the last `months` calendar months (ET), oldest
 * → newest. Returns { counts, labels } arrays for the line chart.
 */
function monthlyVisitSeries(visits: PageVisit[], months = 12): { counts: number[]; labels: string[] } {
  const now = new Date();
  const byMonth = new Map<string, number>();

  for (const v of visits) {
    if (!v.createdAt) continue;
    const t = new Date(v.createdAt);
    if (isNaN(t.getTime())) continue;
    const k = etDayKey(t).slice(0, 7); // YYYY-MM
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }

  const counts: number[] = [];
  const labels: string[] = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = months - 1; i >= 0; i--) {
    const month = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const k = month.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit" });
    counts.push(byMonth.get(k) ?? 0);
    labels.push(month.toLocaleDateString("en-US", { month: "short", year: "2-digit" }));
  }
  return { counts, labels };
}

/**
 * Bucket signups into monthly series. Returns { counts, labels }.
 */
function monthlySignupSeries(
  signups: Array<{ createdAt: number | null }>,
  months = 12,
): { counts: number[]; labels: string[] } {
  const now = new Date();
  const byMonth = new Map<string, number>();

  for (const s of signups) {
    if (s.createdAt == null) continue;
    const t = new Date(s.createdAt);
    if (isNaN(t.getTime())) continue;
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const k = `${y}-${m}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }

  const counts: number[] = [];
  const labels: string[] = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = months - 1; i >= 0; i--) {
    const month = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const k = month.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit" });
    counts.push(byMonth.get(k) ?? 0);
    labels.push(month.toLocaleDateString("en-US", { month: "short", year: "2-digit" }));
  }
  return { counts, labels };
}

/**
 * Tabbed metrics section — shows Traffic, Signups, and Cumulative Users
 * with daily/weekly/monthly time period tabs (defaults to daily).
 */
function MetricsTabSection({
  visits, signups, users, activeSessions
}: {
  visits: PageVisit[];
  signups: Array<{ createdAt: number | null }>;
  users: number | null;
  activeSessions: number | null;
}) {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const isMobile = useIsMobile();

  // Generate series based on selected period
  const traffic = period === "daily" ? dailyVisitSeries(visits, 7)
    : period === "weekly" ? weeklyVisitSeries(visits, 12)
    : monthlyVisitSeries(visits, 12);

  const signupsSeries = period === "daily" ? dailySignupSeries(signups, 7)
    : period === "weekly" ? weeklySignupSeries(signups, 7)
    : monthlySignupSeries(signups, 12);

  const cumulativeSeries = (() => {
    const cum: number[] = [];
    const baseLine = (users ?? 0) - signupsSeries.counts.reduce((a, b) => a + b, 0);
    signupsSeries.counts.reduce((acc, v) => { const n = acc + v; cum.push(n); return n; }, baseLine);
    return cum;
  })();

  const trafficMax = Math.max(...traffic.counts, 1);
  const signupsMax = Math.max(...signupsSeries.counts, 1);
  const cumulativeMax = Math.max(...cumulativeSeries, 1);
  const trafficDelta = traffic.counts.length >= 2 && traffic.counts[0] > 0
    ? Math.round(((traffic.counts[traffic.counts.length - 1] - traffic.counts[0]) / traffic.counts[0]) * 100) : null;

  const TabButton = ({ p, label }: { p: typeof period; label: string }) => (
    <button
      onClick={() => setPeriod(p)}
      style={{
        padding: "4px 10px",
        fontSize: 14,
        borderRadius: 5,
        border: `1px solid ${period === p ? HOME_THEME.cyan : HOME_THEME.border}`,
        background: period === p ? `${HOME_THEME.cyan}18` : "transparent",
        color: period === p ? HOME_THEME.cyan : HOME_THEME.text,
        fontWeight: period === p ? 600 : 400,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Tab buttons */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
        <div className="tab-strip" style={{ display: "flex", gap: 6 }}>
          <TabButton p="daily" label="Daily" />
          <TabButton p="weekly" label="Weekly" />
          <TabButton p="monthly" label="Monthly" />
        </div>
        <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7, fontFamily: "var(--font-mono)" }}>
          {period === "daily" ? "7 days" : period === "weekly" ? "12 weeks" : "12 months"}
        </span>
      </div>

      {/* Three metric cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(3, minmax(0,1fr))", gap: 10 }}>
        {/* Traffic card */}
        <div style={{ ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11 }}>Traffic · {period}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 110, marginBottom: 0, position: "relative" }}>
            {traffic.counts.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: HOME_THEME.text, marginBottom: 2, height: 14, minWidth: 0 }}>
                  {v > 0 ? v : ""}
                </div>
                <div style={{ width: "100%", background: HOME_THEME.orange, borderRadius: "4px 4px 0 0", height: `${Math.max(2, Math.round((v / trafficMax) * 82))}px` }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 6 }}>
            {traffic.labels.map((l, i) => (
              <div key={i} style={{ flex: 1, fontSize: 12, color: HOME_THEME.text, opacity: 0.6, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>
            <span>{traffic.counts.reduce((a, b) => a + b, 0).toLocaleString()} visits</span>
            {trafficDelta != null && <span style={{ color: trafficDelta >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{trafficDelta >= 0 ? "▲" : "▼"} {Math.abs(trafficDelta)}%</span>}
          </div>
        </div>

        {/* Signups card */}
        <div style={{ ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11 }}>Signups · {period}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 110, marginBottom: 0 }}>
            {signupsSeries.counts.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: HOME_THEME.text, marginBottom: 2, height: 14, minWidth: 0 }}>
                  {v > 0 ? v : ""}
                </div>
                <div style={{ width: "100%", background: HOME_THEME.green, borderRadius: "4px 4px 0 0", height: `${Math.max(2, Math.round((v / signupsMax) * 82))}px` }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 6 }}>
            {signupsSeries.labels.map((l, i) => (
              <div key={i} style={{ flex: 1, fontSize: 12, color: HOME_THEME.text, opacity: 0.6, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>
            <span>{signupsSeries.counts.reduce((a, b) => a + b, 0)} new</span>
            <span style={{ color: HOME_THEME.green }}>▲ {signupsSeries.counts[signupsSeries.counts.length - 1]} this {period === "monthly" ? "mo" : period === "weekly" ? "wk" : "day"}</span>
          </div>
        </div>

        {/* Cumulative Users card */}
        <div style={{ ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11 }}>Cumulative users · {period}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 110, marginBottom: 0 }}>
            {cumulativeSeries.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: HOME_THEME.text, marginBottom: 2, height: 14, minWidth: 0 }}>
                  {v > 0 ? v.toLocaleString() : ""}
                </div>
                <div style={{ width: "100%", background: HOME_THEME.purple, borderRadius: "4px 4px 0 0", height: `${Math.max(2, Math.round((v / cumulativeMax) * 82))}px` }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 6 }}>
            {signupsSeries.labels.map((l, i) => (
              <div key={i} style={{ flex: 1, fontSize: 12, color: HOME_THEME.text, opacity: 0.6, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>
            <span>{users != null ? `${users.toLocaleString()} total` : "—"}</span>
            <span>{activeSessions != null ? `${activeSessions} logged in` : ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewSection({ metrics }: {
  metrics: {
    daily: { counts: number[]; labels: string[] };
    heatmap: { grid: number[][]; max: number };
    dailySignups: { counts: number[]; labels: string[] };
    weekly: { counts: number[]; labels: string[] };
    totalVisits: number;
    activePages: number;
    users: number | null;
    waitlist: number | null;
    activeSessions: number | null;
    onToday: number;
    uptime: string;
    feed: Array<{ label: string; loads: number; ago: string; active: boolean }>;
    topPages: Array<{ label: string; loads: number }>;
    rowsToday: Array<{ label: string; rows: number }>;
    visits: PageVisit[];
    signups: Array<{ createdAt: number | null }>;
    infra: {
      cpu: { value: string; spark: number[] };
      memory: { value: string; spark: number[] };
      hostNet: { value: string; spark: number[] };
      cfEgress: { value: string; spark: number[] };
      wsPerHr: string;
      wsSplit: string;
    };
    ops: {
      feedbackOpen: number;
      levelsCount: number;
      levelsRun: string | null;
      staleEm: number;
      eodToday: number;
      maintenance: boolean;
    };
  };
}) {
  const { daily, heatmap, dailySignups, weekly, totalVisits, activePages, users, waitlist, activeSessions, onToday, topPages, rowsToday, visits, signups, infra, ops } = metrics;
  void activePages;
  const isMobile = useIsMobile();

  // ── Command center — Metabase-style multi-color on dark. ──
  // Categorical palette: each metric/series/row gets its own hue.
  const PALETTE = ["#3FB8A0", "#5DBB8E", "#E8A23D", "#5B9BD5", "#E0A85E", "#E06C5E", "#4FB3C9", "#88C97A"];
  const pc = (i: number) => PALETTE[i % PALETTE.length];
  const TRACK = "rgba(255,255,255,0.06)";
  const cardStyle: React.CSSProperties = { ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 };
  const titleStyle: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11 };

  // Traffic — 7-day rolling daily bar chart (bars read far more clearly than a
  // squished min/max line, especially when daily counts are close together).
  const traffic = daily.counts.length ? daily.counts : [0];
  const tMax = Math.max(...traffic, 1);

  // Cumulative users — 7-day rolling: running total of daily signups, baselined
  // so the last bar lands on the current total user count.
  const cum: number[] = [];
  dailySignups.counts.reduce((acc, v) => { const n = acc + v; cum.push(n); return n; }, (users ?? 0) - dailySignups.counts.reduce((a, b) => a + b, 0));
  const cMax = Math.max(...(cum.length ? cum : [1]), 1);

  const wkMax = weekly.counts.length ? Math.max(...weekly.counts) : 1;
  const topMax = topPages.length ? Math.max(...topPages.map((p) => p.loads), 1) : 1;
  const rowsMax = rowsToday.length ? Math.max(...rowsToday.map((r) => r.rows), 1) : 1; void tMax; void cMax; void wkMax;
  const trafficDelta = traffic.length >= 2 && traffic[0] > 0
    ? Math.round(((traffic[traffic.length - 1] - traffic[0]) / traffic[0]) * 100) : null;
  void trafficDelta;

  // Mini horizontal-bar list — each row its own color.
  const BarList = ({ rows, max, mono }: { rows: { label: string; n: number }[]; max: number; mono?: boolean }) => (
    <div>
      {rows.map((r, i) => (
        <div key={r.label + i} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 3, color: HOME_THEME.text, fontFamily: mono ? "monospace" : "inherit" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: pc(i), flexShrink: 0 }} />{r.label}
            </span>
            <span style={{ color: HOME_THEME.text, opacity: 1 }}>{r.n.toLocaleString()}</span>
          </div>
          <div style={{ height: 7, background: TRACK, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((r.n / max) * 100)}%`, background: pc(i), borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );

  const InfraRow = ({ label, value, spark, color }: { label: string; value: string; spark: number[]; color: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `0.5px solid ${HOME_THEME.border}` }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 600, color: HOME_THEME.text, width: 110 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />{label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", width: 90, color: HOME_THEME.text }}>{value}</span>
      <div style={{ marginLeft: "auto", width: 64 }}><Sparkline data={spark} accent={color} height={20} /></div>
    </div>
  );

  const OpsRow = ({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: "10px 0", borderBottom: last ? "none" : `0.5px solid ${HOME_THEME.border}`, color: HOME_THEME.text }}>
      <span>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{children}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(7, minmax(0,1fr))", gap: 10 }}>
        {[
          { l: "Visits · 12d", v: totalVisits.toLocaleString() },
          { l: "Total users", v: users != null ? users.toLocaleString() : "—" },
          { l: "On today", v: onToday.toLocaleString() },
          { l: "Logged in · 30d", v: activeSessions != null ? activeSessions.toLocaleString() : "—" },
          { l: "Waitlist", v: waitlist != null ? waitlist.toLocaleString() : "—" },
          { l: "CPU", v: infra.cpu.value },
          { l: "WS out/hr", v: infra.wsPerHr },
        ].map((k) => (
          <div key={k.l} style={{ ...homePanelStyle, padding: "11px 13px" }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, opacity: 0.6, marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "0.01em" }}>{k.l}</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.cyan, lineHeight: 1 }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Traffic · signups · cumulative with tabs */}
      <MetricsTabSection visits={visits} signups={signups} users={users} activeSessions={activeSessions} />

      {/* Top pages · rows today */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "1fr 1fr", gap: 10 }}>
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: pc(3) }} />Top pages · by loads</div>
          {topPages.length === 0
            ? <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>No page loads recorded yet.</div>
            : <BarList rows={topPages.map((p) => ({ label: p.label, n: p.loads }))} max={topMax} mono />}
        </div>
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: pc(1) }} />Rows written today · by table</div>
          <BarList rows={rowsToday.map((r) => ({ label: r.label, n: r.rows }))} max={rowsMax} mono />
        </div>
      </div>

      {/* Hourly heatmap — real page_visits rows, bucketed by hour × weekday (ET). */}
      <div style={cardStyle}>
        <div style={{ ...titleStyle, display: "flex", justifyContent: "space-between" }}>
          <span>Hourly load heatmap · visits by hour × weekday (ET)</span>
          <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>
            {heatmap.grid.flat().reduce((a, b) => a + b, 0)} visits · last 5000
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "32px repeat(24, 1fr)", gap: 2 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={"h" + h} style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, textAlign: "center" }}>{h % 6 === 0 ? h : ""}</div>
          ))}
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, di) => (
            <Fragment key={d}>
              <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, lineHeight: "30px" }}>{d}</div>
              {heatmap.grid[di].map((count, h) => {
                const v = count > 0 ? 0.06 + (count / heatmap.max) * 0.85 : 0.03;
                return (
                  <div
                    key={d + h}
                    title={`${d} ${h}:00 ET · ${count} visit${count === 1 ? "" : "s"}`}
                    style={{ height: 30, borderRadius: 2, background: `rgba(91,155,213,${v.toFixed(2)})` }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Infra · ops */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "1fr 1fr", gap: 10 }}>
        <div style={cardStyle}>
          <div style={titleStyle}>Infra · live</div>
          <InfraRow label="CPU" value={infra.cpu.value} spark={infra.cpu.spark} color={pc(4)} />
          <InfraRow label="Memory" value={infra.memory.value} spark={infra.memory.spark} color={pc(2)} />
          <InfraRow label="Host net 1h" value={infra.hostNet.value} spark={infra.hostNet.spark} color={pc(3)} />
          <InfraRow label="CF egress 24h" value={infra.cfEgress.value} spark={infra.cfEgress.spark} color={pc(6)} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: HOME_THEME.text, opacity: 1, width: 110 }}>WS split</span>
            <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>{infra.wsSplit}</span>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={titleStyle}>Ops queues</div>
          <OpsRow label="Feedback open">{ops.feedbackOpen}</OpsRow>
          <OpsRow label="Levels published">{ops.levelsCount} <span style={{ color: HOME_THEME.text, opacity: 1 }}>· {fmtLastRun(ops.levelsRun)}</span></OpsRow>
          <OpsRow label="Stale EM tickers">
            {ops.staleEm > 0
              ? <span style={{ color: HOME_THEME.red }}>{ops.staleEm}</span>
              : <span style={{ color: HOME_THEME.text, opacity: 1 }}>0</span>}
          </OpsRow>
          <OpsRow label="EOD GEX today">
            {ops.eodToday > 0 ? `${ops.eodToday} saved` : <span style={{ color: HOME_THEME.text, opacity: 1 }}>not yet · fires 3:55pm</span>}
          </OpsRow>
          <OpsRow label="Maintenance" last>
            {ops.maintenance ? <span style={{ color: HOME_THEME.red }}>ON</span> : <span style={{ color: HOME_THEME.text, opacity: 1 }}>off</span>}
          </OpsRow>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// FE / BE tab + accordion (one section open at a time). The `tab` of each
// section decides which page it shows on; sort sections later by editing TAB.
type OwnerTab = "overview" | "infra";

export default function ControlPanel() {
  const isMobile = useIsMobile();
  // Active page tab (persisted). Sections are assigned to a tab via SECTION_TAB.
  const [ownerTab, setOwnerTab] = useState<OwnerTab>("overview");
  useEffect(() => {
    try {
      // A ?tab= URL param wins over the persisted tab (e.g. the admin page's
      // "Owner ↗" link deep-links to /dev/owner?tab=overview).
      const VALID_TABS: string[] = ["overview", "infra", "probe", "social-media"];
      const param = new URLSearchParams(window.location.search).get("tab");
      if (param && VALID_TABS.includes(param)) {
        setOwnerTab(param as OwnerTab);
        localStorage.setItem("owner-tab", param);
        return;
      }
      const v = localStorage.getItem("owner-tab") as OwnerTab | null;
      if (v && VALID_TABS.includes(v)) setOwnerTab(v);
    } catch { /* ignore */ }
  }, []);
  const selectTab = useCallback((t: OwnerTab) => {
    setOwnerTab(t);
    try { localStorage.setItem("owner-tab", t); } catch { /* ignore */ }
  }, []);

  // The owner rail navigates sections via ?tab=… — react to that (client-side nav
  // keeps this page mounted, so the mount effect above won't re-run).
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const VALID_TABS: OwnerTab[] = ["overview","infra"];
    const param = searchParams.get("tab") as OwnerTab | null;
    if (param && VALID_TABS.includes(param)) {
      setOwnerTab(param);
      try { localStorage.setItem("owner-tab", param); } catch { /* ignore */ }
    }
  }, [searchParams]);

  // Section cards: multi-open. ALL sections start expanded on page load. Each
  // card toggles independently (no longer an accordion). Persisted so a reload
  // keeps the user's open/closed choices; first-ever load defaults to all open.
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set(Object.keys(SECTION_TAB)));
  useEffect(() => {
    try {
      const v = localStorage.getItem("owner-open-sections");
      if (v != null) {
        // Restore persisted open/closed choices, but always include any sections
        // added since the set was last saved (e.g. "feedback") so a new card
        // isn't hidden by a stale localStorage value.
        const restored = new Set(JSON.parse(v) as string[]);
        for (const k of Object.keys(SECTION_TAB)) restored.add(k);
        setOpenSet(restored);
      }
    } catch { /* ignore */ }
  }, []);
  const toggleSection = useCallback((id: string) => {
    setOpenSet((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("owner-open-sections", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

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

  // Auth status (Supabase). Null until first fetch.
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  // Customer feedback feed
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [feedbackOpenCount, setFeedbackOpenCount] = useState(0);
  const [feedbackShowResolved, setFeedbackShowResolved] = useState(false);
  const loadFeedback = useCallback(async (throwOnError = false) => {
    try {
      const r = await fetch("/api/feedback", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setFeedback(Array.isArray(j.items) ? j.items : []);
      setFeedbackOpenCount(Number(j.openCount ?? 0));
    } catch (e) { if (throwOnError) throw e; /* else ignore */ }
  }, []);
  const { trigger: feedbackRefresh, label: feedbackRefreshLabel, style: feedbackRefreshStyle } =
    useRefreshButton(useCallback(async () => { await loadFeedback(true); }, [loadFeedback]));
  const resolveFeedback = useCallback(async (id: number, status: "open" | "resolved") => {
    try {
      await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await loadFeedback();
    } catch { /* ignore */ }
  }, [loadFeedback]);
  useEffect(() => { loadFeedback(); }, [loadFeedback]);

  // Visit log (page loads w/ IP). Collapsed state persisted in localStorage.
  const [visits, setVisits] = useState<PageVisit[]>([]);
  const [visitLogCollapsed, setVisitLogCollapsed] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("owner-visit-log-collapsed");
      if (v != null) setVisitLogCollapsed(v === "1");
    } catch { /* ignore */ }
  }, []);
  const toggleVisitLog = useCallback(() => {
    setVisitLogCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("owner-visit-log-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

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
  const [levelsCollapsed] = useState(true);

  // Page Activity section collapsed state (persisted across reloads).
  const [pageActCollapsed, setPageActCollapsed] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("owner-page-activity-collapsed");
      if (v != null) setPageActCollapsed(v === "1");
    } catch { /* ignore */ }
  }, []);
  const togglePageAct = useCallback(() => {
    setPageActCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("owner-page-activity-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  void togglePageAct; void toggleVisitLog; void visitLogCollapsed; void pageActCollapsed;

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

  // Signal Alerts — live DB-backed per-alert-key toggles for the background
  // trade-signal engine (server-v2/signals-engine.js). Replaces the old
  // compile-time env-var kill switches; flipping one here takes effect within
  // ~20s (the engine's poll cadence), no redeploy/restart needed.
  type SignalAlertRow = { key: string; label: string; group: string; enabled: boolean };
  const [signalAlerts, setSignalAlerts] = useState<SignalAlertRow[] | null>(null);
  const [signalAlertsBusy, setSignalAlertsBusy] = useState<string | null>(null);

  const loadSignalAlerts = useCallback(async () => {
    try {
      const r = await fetch("/proxy/signal-alerts");
      const j = await r.json();
      if (Array.isArray(j?.alerts)) setSignalAlerts(j.alerts);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadSignalAlerts(); }, [loadSignalAlerts]);

  const toggleSignalAlert = useCallback(async (key: string, current: boolean) => {
    const next = !current;
    setSignalAlertsBusy(key);
    // Optimistic flip.
    setSignalAlerts((rows) => rows ? rows.map((r) => (r.key === key ? { ...r, enabled: next } : r)) : rows);
    try {
      const r = await fetch("/proxy/signal-alerts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: next }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      flashMsg(`sigalert-${key}`, `${key} → ${next ? "ON" : "OFF"}`, true);
    } catch (e) {
      // Revert on failure.
      setSignalAlerts((rows) => rows ? rows.map((r) => (r.key === key ? { ...r, enabled: current } : r)) : rows);
      flashMsg(`sigalert-${key}`, `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally {
      setSignalAlertsBusy(null);
    }
  }, [flashMsg]);

  // /ws/gex status socket (drives the "Proxy WS" badge + snapshot-derived KPIs).
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
          totalLoads: Number(r.total_loads ?? r.totalLoads ?? 0),
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

      // Page-visit log (per-load rows w/ timestamps) — powers the Overview tab's
      // Daily Activity (last 12 days) + recent-activity agenda from real data.
      try {
        const pv = await fetch("/api/page-visits?limit=5000", { cache: "no-store" });
        if (pv.ok) { const j = await pv.json(); setVisits((j?.visits ?? []) as PageVisit[]); }
      } catch { /* non-fatal */ }

      // Auth status (masked — never includes any secret value).
      try {
        const ck = await fetch("/api/auth-status", { cache: "no-store" });
        if (ck.ok) { setAuthStatus((await ck.json()) as AuthStatus); }
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
      flashMsg("mvcAuto", next ? "CB - Core Bullseye auto-snapshot ON" : "CB - Core Bullseye auto-snapshot OFF", true);
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
      // force=1 → manual owner snapshot overrides the outside-RTH guard.
      const r = await fetch("/proxy/mvc-snapshot?force=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const j = await r.json();
      flashMsg("mvcSnap", j?.ok ? `Snapshot saved · MVC ${j.strike} · SPX ${j.spot}` : `Skipped: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("mvcSnap", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); void refresh(); }
  }, [flashMsg, refresh]);

  const doPremarketRun = useCallback(async () => {
    setCtlBusy("premarket");
    try {
      const r = await fetch("/proxy/premarket-summary-run", { method: "POST" });
      const j = await r.json();
      flashMsg("premarket", j?.ok ? "Premarket summary generated" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("premarket", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); void refresh(); }
  }, [flashMsg, refresh]);

  const doStrategyRun = useCallback(async () => {
    setCtlBusy("strategy");
    try {
      const r = await fetch("/proxy/strategy-run", { method: "POST" });
      const j = await r.json();
      flashMsg("strategy", j?.ok ? "Daily strategy generated" : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("strategy", `Failed: ${String((e as Error)?.message || e)}`, false);
    } finally { setCtlBusy(null); void refresh(); }
  }, [flashMsg, refresh]);

  const doClearChat = useCallback(async () => {
    if (!window.confirm("Erase ALL subscriber chat messages? This cannot be undone.")) return;
    setCtlBusy("clearChat");
    try {
      const r = await fetch("/api/chat/clear", { method: "POST" });
      const j = await r.json();
      flashMsg("clearChat", j?.ok ? `Chat cleared (${j.deleted ?? "?"} messages)` : `Failed: ${j?.error || r.status}`, !!j?.ok);
    } catch (e) {
      flashMsg("clearChat", `Failed: ${String((e as Error)?.message || e)}`, false);
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
      // Server-side gate: the proxy rejects any publish POST without this token,
      // so a bare/accidental POST can't republish. Only this confirmed path sends it.
      await fetch("/proxy/levels-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "PUBLISH" }),
      });
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
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // ── WebSocket status tap ──────────────────────────────────────────────────
  // Keeps a /ws/gex socket open purely to (a) drive the header "Proxy WS" badge
  // via wsConnected and (b) parse `snapshot` frames into server status (uptime,
  // dxLink/TT state, contracts, spot) for the System KPI cards. The live log
  // cards were removed, so no per-message logging happens here anymore.

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
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* */ }
      };

      ws.onclose = () => {
        setWsConnected(false);
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
  }, []);

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

  // ── Overview tab metrics (all from real front-end data) ─────────────────────
  const overviewMetrics = (() => {
    const labelFor = (key: string): string => {
      const hit = NAV_GROUPS.flatMap((g) => g.items).find(
        (it) => it.href.replace(/^\//, "") === key || it.href === key
      );
      return hit?.label ?? key;
    };
    const totalVisits = pageStatuses.reduce((sum, p) => sum + (p.totalLoads ?? 0), 0);
    const activePages = pageStatuses.filter((p) => p.status === "active").length;
    const feed = pageStatuses
      .filter((p) => p.lastSeen && !isNaN(new Date(p.lastSeen).getTime()))
      .sort((a, b) => new Date(b.lastSeen!).getTime() - new Date(a.lastSeen!).getTime())
      .slice(0, 7)
      .map((p) => ({
        label: labelFor(p.pageKey),
        loads: p.totalLoads ?? 0,
        ago: fmtAgo(p.lastSeen),
        active: p.status === "active",
      }));
    const signups = (authStatus?.stats?.recent ?? []).map((u) => ({ createdAt: u.createdAt }));

    // Top pages by lifetime loads (real, from page_load_status totalLoads).
    const topPages = [...pageStatuses]
      .sort((a, b) => (b.totalLoads ?? 0) - (a.totalLoads ?? 0))
      .slice(0, 5)
      .map((p) => ({ label: "/" + p.pageKey.replace(/^\//, ""), loads: p.totalLoads ?? 0 }));

    // Rows written today per tracked table (real, from /api/db counts in dbStats).
    const rowsToday = TABLES.map((t) => ({ label: t.label, rows: dbStats[t.id] ?? 0 }));

    // Infra — live values + sparklines from Hetzner/CF/self metrics.
    const fmtBytes = (v: number | null): string =>
      v == null ? "—" : v < 1024 ? `${v.toFixed(0)} MB` : `${(v / 1024).toFixed(2)} GB`;
    const wsTotal = wsBw ? wsBw.lastMinTotal : 0;
    const wsPerHr = wsTotal ? (wsTotal * 60) / 1024 / 1024 : 0; // bytes/min → MB/hr
    const infra = {
      cpu: { value: cpuPct ? `${cpuPct.toFixed(0)}%` : "—", spark: renderMetrics?.cpu.spark ?? [] },
      memory: { value: memMb ? `${memMb.toFixed(0)} MB` : "—", spark: renderMetrics?.memory.spark ?? [] },
      hostNet: { value: fmtBytes(renderMetrics?.bandwidth.value ?? null), spark: renderMetrics?.bandwidth.spark ?? [] },
      cfEgress: { value: fmtBytes(cfMetrics?.egress.value ?? null), spark: cfMetrics?.egress.spark ?? [] },
      wsPerHr: wsPerHr ? `${wsPerHr.toFixed(1)} MB` : "—",
      wsSplit: wsBw && wsBw.lastMinTotal
        ? Object.entries(wsBw.lastMin)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v]) => `${k} ${Math.round((v / wsBw.lastMinTotal) * 100)}%`)
            .join(" · ")
        : "—",
    };

    // Ops queue — real counts/states.
    const staleEm = levels.tickers.filter((t) => t.stale).length;
    const ops = {
      feedbackOpen: feedbackOpenCount,
      levelsCount: levels.count,
      levelsRun: levels.lastRun,
      staleEm,
      eodToday: eodGex.length,
      maintenance: maint === true,
    };

    // Unique visitors "on today" — distinct user (ip fallback for logged-out)
    // seen since midnight ET. The real "who came today", unlike activeSessions
    // which counts 30-day-unexpired logins regardless of recent activity.
    const etToday = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
    const onTodaySet = new Set<string>();
    for (const v of visits) {
      if (!v.createdAt) continue;
      const t = new Date(v.createdAt);
      if (isNaN(t.getTime())) continue;
      if (t.toLocaleDateString("en-US", { timeZone: "America/New_York" }) !== etToday) continue;
      const key = v.userId || (v.ip ? `ip:${v.ip}` : "");
      if (key) onTodaySet.add(key);
    }
    const onToday = onTodaySet.size;

    return {
      daily: dailyVisitSeries(visits, 7),
      heatmap: hourlyHeatmap(visits),
      dailySignups: dailySignupSeries(signups, 7),
      weekly: weeklySignupSeries(signups, 7),
      totalVisits,
      activePages,
      users: authStatus?.stats?.userCount ?? null,
      waitlist: waitlistCount,
      activeSessions: authStatus?.stats?.activeSessions ?? null,
      onToday,
      uptime: displayUptime != null ? fmtUptime(displayUptime) : "—",
      feed,
      topPages,
      rowsToday,
      visits,
      signups,
      infra,
      ops,
    };
  })();

  // ── Sidebar nav items ──────────────────────────────────────────────────────
  const NAV_ITEMS: { id: OwnerTab; label: string; badge?: string | number; badgeRed?: boolean }[] = [
    { id: "overview",       label: "Overview" },
    { id: "infra",          label: "Infra" },
  ];
  // Inject feedback badge on overview
  const feedbackBadge = feedbackOpenCount > 0 ? feedbackOpenCount : undefined;

  // Status dot rows for the sidebar
  const STATUS_ROWS: { label: string; ok: boolean; sub?: string }[] = [
    { label: "Server",    ok: isServerUp,       sub: isServerUp ? (displayUptime != null ? fmtUptime(displayUptime) : undefined) : "idle" },
    { label: "Postgres",  ok: !!dbHealth?.ok,   sub: dbHealth?.ok ? `${dbHealth.latencyMs}ms` : "down" },
    { label: "Theta",     ok: isServerUp && server.spot != null, sub: server.spot != null ? `spot ${server.spot.toFixed(0)}` : "no data" },
    { label: "Greeks",    ok: isServerUp && (server.contractsSubscribed ?? 0) > 0, sub: server.contractsSubscribed != null ? `${server.contractsSubscribed.toLocaleString()} contracts` : "—" },
    { label: "Feed",      ok: isServerUp && lastFeedAgo != null && lastFeedAgo < 10, sub: lastFeedAgo != null ? `${lastFeedAgo}s ago` : "—" },
    { label: "WS proxy",  ok: wsConnected,       sub: wsConnected ? `${server.wsClients ?? 0} clients` : "offline" },
    { label: "dxLink",    ok: dxOk,             sub: server.dxLinkState ?? "—" },
  ];

  // Mobile sidebar drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close drawer when switching to desktop
  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  // Sidebar content extracted so it can render both in the fixed panel (desktop)
  // and the slide-in drawer (mobile).
  const SidebarContent = () => (
    <>
      {/* Logo row */}
      <div style={{
        padding: "14px 16px 12px",
        borderBottom: `1px solid ${HOME_THEME.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: HOME_THEME.text, letterSpacing: "0.02em" }}>CB Edge</div>
          <div style={{ fontSize: 14, color: `${HOME_THEME.cyan}cc`, letterSpacing: "0.08em", marginTop: 2 }}>OWNER DASHBOARD</div>
        </div>
        {isMobile && (
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: "transparent", border: "none", color: HOME_THEME.text, fontSize: 14, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}
          >✕</button>
        )}
      </div>

      {/* Status dots */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${HOME_THEME.border}` }}>
        {STATUS_ROWS.map((row) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: row.ok ? HOME_THEME.green : HOME_THEME.red,
                boxShadow: row.ok ? `0 0 5px ${HOME_THEME.green}88` : `0 0 5px ${HOME_THEME.red}88`,
              }} />
              <span style={{ fontSize: 14, color: HOME_THEME.text }}>{row.label}</span>
            </div>
            {row.sub && <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>{row.sub}</span>}
          </div>
        ))}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 1, letterSpacing: "0.12em", textTransform: "uppercase", padding: "4px 8px 6px" }}>SECTIONS</div>
        {NAV_ITEMS.map((item) => {
          const active = ownerTab === item.id;
          const badge = item.id === "overview" ? feedbackBadge : item.badge;
          return (
            <button
              key={item.id}
              className="owner-nav-item"
              onClick={() => { selectTab(item.id); if (isMobile) setDrawerOpen(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", textAlign: "left",
                padding: "10px 10px", borderRadius: 7,
                border: active ? `1px solid ${HOME_THEME.cyan}44` : "1px solid transparent",
                background: active ? `linear-gradient(135deg, ${HOME_THEME.cyan}18, ${HOME_THEME.cyan}08)` : "transparent",
                color: active ? HOME_THEME.cyan : HOME_THEME.text,
                fontSize: 14, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <span>{item.label}</span>
              {badge != null && (
                <span style={{
                  fontSize: 14, padding: "1px 6px", borderRadius: 10, fontWeight: 600,
                  background: item.badgeRed ? `${HOME_THEME.red}22` : `${HOME_THEME.cyan}22`,
                  color: item.badgeRed ? HOME_THEME.red : HOME_THEME.cyan,
                  border: `1px solid ${item.badgeRed ? HOME_THEME.red : HOME_THEME.cyan}44`,
                }}>{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick controls */}
      <div style={{ padding: "10px 8px 14px", borderTop: `1px solid ${HOME_THEME.border}`, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 17, color: HOME_THEME.text, opacity: 1, letterSpacing: "0.12em", textTransform: "uppercase", padding: "0 8px 4px" }}>QUICK CONTROLS</div>
        {[
          { key: "idle",    label: isIdle == null ? "Idle mode: —" : isIdle ? "● Idle ON — resume" : "○ Idle OFF — pause", action: toggleIdle },
          { key: "mvcAuto", label: mvcAuto == null ? "CB Auto: —" : mvcAuto ? "● CB Auto ON" : "○ CB Auto OFF",       action: toggleMvcAuto },
          { key: "maint",   label: maint == null ? "Maintenance: —" : maint ? "● Maint ON — go live" : "○ Maint OFF",   action: toggleMaint },
          { key: "reconnect", label: "↻ Reconnect feed", action: doReconnect },
        ].map(({ key, label, action }) => (
          <button
            key={key}
            className="owner-ctrl-btn"
            onClick={action}
            disabled={ctlBusy === key}
            style={{
              width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 6,
              fontSize: 14, cursor: ctlBusy === key ? "wait" : "pointer",
              fontFamily: "inherit",
              border: `1px solid ${HOME_THEME.border}`,
              background: "transparent",
              color: HOME_THEME.text,
              opacity: ctlBusy === key ? 0.5 : 1,
            }}
          >
            {ctlBusy === key ? "…" : label}
          </button>
        ))}
        {ctlMsg && (
          <div style={{
            fontSize: 14, fontFamily: "var(--font-mono)", padding: "5px 8px", borderRadius: 6, marginTop: 2,
            background: ctlMsg.ok ? "rgba(255,255,255,0.04)" : `${HOME_THEME.red}15`,
            border: `1px solid ${ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red}44`,
            color: ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red,
          }}>
            {ctlMsg.ok ? "✓ " : "✗ "}{ctlMsg.text}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div style={{ ...homeShellStyle, height: "100%", maxHeight: "100%", flexDirection: "row" }}>
      <style>{`
        .owner-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .owner-scroll::-webkit-scrollbar-track { background: transparent; }
        .owner-scroll::-webkit-scrollbar-thumb { background: ${HOME_THEME.cyan}40; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        .owner-scroll::-webkit-scrollbar-thumb:hover { background: ${HOME_THEME.cyan}80; background-clip: padding-box; }
        .owner-scroll { scrollbar-width: thin; scrollbar-color: ${HOME_THEME.cyan}40 transparent; }
        .owner-nav-item { transition: background 0.12s, color 0.12s; }
        .owner-nav-item:hover { background: rgba(255,255,255,0.05) !important; }
        .owner-ctrl-btn:hover { background: rgba(255,255,255,0.07) !important; color: ${HOME_THEME.text} !important; }
        .owner-tab-bar::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── MOBILE DRAWER OVERLAY ─────────────────────────────────────────────── */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)",
          }}
        />
      )}
      {isMobile && (
        <div style={{
          position: "fixed", top: 0, left: 0, bottom: 0,
          width: 288, zIndex: 201,
          background: HOME_THEME.panelBg,
          borderRight: `1px solid ${HOME_THEME.border}`,
          display: "flex", flexDirection: "column",
          transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
          overflowY: "auto",
        }}>
          <SidebarContent />
        </div>
      )}

      {/* Desktop section nav + status + quick controls now live in the shared
          owner rail (LayoutShell → OwnerSidebar) and the OpsBar header below.
          The internal desktop sidebar was removed to kill the duplicate rail. */}

      {/* ── RIGHT MAIN ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Slim top bar */}
        <div style={{ ...homeHeaderStyle, padding: isMobile ? "10px 12px" : "10px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {isMobile && (
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                style={{
                  background: "transparent", border: `1px solid ${HOME_THEME.border}`,
                  color: HOME_THEME.text, fontSize: 17, cursor: "pointer",
                  padding: "5px 10px", borderRadius: 7, lineHeight: 1, flexShrink: 0,
                }}
              >☰</button>
            )}
            <div style={{ fontSize: 17, fontWeight: 500, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isMobile ? "Owner" : (NAV_ITEMS.find(n => n.id === ownerTab)?.label ?? "Overview")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {lastRefresh && !isMobile && (
              <span style={{ fontSize: 14, color: `${HOME_THEME.text}`, fontFamily: "var(--font-mono)" }}>
                {lastRefresh.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            )}
            <button onClick={refresh} disabled={loading} style={homeButtonStyle}>
              {loading ? "…" : "↻"}
            </button>
          </div>
        </div>

        {/* OpsBar removed — its live status dots now render as a dedicated "Status"
            card, and its on/off toggles live in the "Controls" card, both under
            the Infra tab. */}

        {/* Mobile tab strip */}
        {isMobile && (
          <div style={{
            display: "flex", overflowX: "auto", gap: 4, padding: "6px 10px",
            borderBottom: `1px solid ${HOME_THEME.border}`,
            scrollbarWidth: "none" as const,
          }}
          className="owner-tab-bar"
        >
            <div style={{ display: "flex", gap: 4 }}>
              {NAV_ITEMS.map((item) => {
                const active = ownerTab === item.id;
                const badge = item.id === "overview" ? feedbackBadge : item.badge;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectTab(item.id)}
                    style={{
                      flexShrink: 0, padding: "6px 12px", borderRadius: 20,
                      border: active ? `1px solid ${HOME_THEME.cyan}55` : `1px solid ${HOME_THEME.border}`,
                      background: active ? `${HOME_THEME.cyan}18` : "transparent",
                      color: active ? HOME_THEME.cyan : HOME_THEME.text,
                      fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                    {badge != null && (
                      <span style={{
                        fontSize: 14, padding: "0 5px", borderRadius: 10, fontWeight: 700,
                        background: item.badgeRed ? `${HOME_THEME.red}33` : `${HOME_THEME.cyan}33`,
                        color: item.badgeRed ? HOME_THEME.red : HOME_THEME.cyan,
                      }}>{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div
          className="owner-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            height: 0,           // force flex child to shrink so overflowY kicks in
            overflowY: "auto",
            overflowX: "hidden",
            padding: isMobile ? "12px" : "clamp(14px,2vw,24px)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            WebkitOverflowScrolling: "touch",
          } as React.CSSProperties}
        >
        {/* ── Overview dashboard (real front-end data) ── */}
        {ownerTab === "overview" && <OverviewSection metrics={overviewMetrics} />}

        {/* ── Flow / EM ticker visit trackers (overview tab, above feedback) ── */}
        {ownerTab === "overview" && (
          <>
            <TickerVisitsCard source="flow" icon="📡" label="Flow · Ticker Visits" />
            <TickerVisitsCard source="em" icon="🎯" label="EM · Ticker Visits" />
          </>
        )}

        {/* ── Customer feedback feed (overview tab) ── */}
        {ownerTab === "overview" && (
        <AccordionCard
          id="feedback"
          title="Feedback"
          subtitle={`${feedbackOpenCount} open · ${feedback.length} total`}
          open={openSet.has("feedback")}
          onToggle={toggleSection}
          accent={HOME_THEME.orange}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                style={{ ...homeSecondaryButtonStyle, color: (feedbackRefreshStyle.color as string) ?? (homeSecondaryButtonStyle as { color?: string }).color }}
                onClick={feedbackRefresh}
              >
                {feedbackRefreshLabel}
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.text, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={feedbackShowResolved}
                  onChange={(e) => setFeedbackShowResolved(e.target.checked)}
                />
                Show resolved
              </label>
            </div>

            {(() => {
              const visible = feedback.filter((f) => feedbackShowResolved || f.status !== "resolved");
              if (visible.length === 0) {
                return <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>No feedback yet.</span>;
              }
              const catColor: Record<string, string> = {
                bug: HOME_THEME.red, idea: HOME_THEME.orange, note: HOME_THEME.cyan, other: HOME_THEME.green,
              };
              return (
                <div className="owner-scroll" style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
              {visible.map((f) => {
                const resolved = f.status === "resolved";
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex", gap: 12, padding: "12px 14px", borderRadius: 10,
                      border: `1px solid ${HOME_THEME.border}`,
                      background: resolved ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
                      opacity: resolved ? 0.55 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{
                          fontSize: 14, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em",
                          padding: "2px 8px", borderRadius: 20,
                          color: catColor[f.category] ?? HOME_THEME.cyan,
                          background: `${catColor[f.category] ?? HOME_THEME.cyan}1a`,
                          border: `1px solid ${catColor[f.category] ?? HOME_THEME.cyan}44`,
                        }}>
                          {f.category}
                        </span>
                        <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>
                          {f.email || f.clerk_user_id || "unknown"}
                        </span>
                        {f.created_at && (
                          <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>
                            {new Date(f.created_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: HOME_THEME.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {f.message}
                      </div>
                    </div>
                    <button
                      style={{ ...homeSecondaryButtonStyle, alignSelf: "flex-start", whiteSpace: "nowrap" }}
                      onClick={() => resolveFeedback(f.id, resolved ? "open" : "resolved")}
                    >
                      {resolved ? "Reopen" : "Resolve"}
                    </button>
                  </div>
                );
              })}
                </div>
              );
            })()}
          </div>
        </AccordionCard>
        )}

        {/* ── System KPIs ── */}
        {/* Note: live status dots (server/postgres/theta/feed/etc.) already show
            in the sidebar (STATUS_ROWS) — no need to duplicate them here. */}
        {SECTION_TAB.system === ownerTab && (
        <AccordionCard
          accent={HOME_THEME.cyan}
          id="system"
          title="System"
          open={openSet.has("system")}
          onToggle={toggleSection}
        >
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))", gap: 10 }}>
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
            <StatCard label="Contracts Sub'd" value={server.contractsSubscribed ?? "—"} accent={HOME_THEME.orange} />
            <StatCard label="Last Feed" value={lastFeedAgo != null ? `${lastFeedAgo}s ago` : "—"} accent={lastFeedAgo != null && lastFeedAgo < 10 ? HOME_THEME.green : HOME_THEME.orange} mono />
            <StatCard label="WS Clients" value={wsConnected ? (server.wsClients ?? 0) : "offline"} accent={wsConnected ? HOME_THEME.green : HOME_THEME.red} mono />
            <StatCard label="SPX Spot" value={server.spot != null ? server.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} accent={HOME_THEME.green} mono />
            <StatCard label="Waitlist Signups" value={waitlistCount != null ? waitlistCount.toLocaleString() : "—"} accent={HOME_THEME.purple} mono />
            <StatCard label="Version" value={(import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION || "—"} accent={HOME_THEME.orange} mono />
          </div>
        </AccordionCard>
        )}

        {/* ── Hetzner hosting + Cloudflare edge metrics ── */}
        {SECTION_TAB.hosting === ownerTab && (
        <AccordionCard
          accent={HOME_THEME.orange}
          id="hosting"
          title="Hosting · Hetzner + Cloudflare"
          subtitle={renderMetrics?.unconfigured ? "setup needed" : `cpu ${renderMetrics?.cpu.value != null ? (renderMetrics.cpu.value * 100).toFixed(0) + "%" : "—"} · mem ${renderMetrics?.memory.value != null ? (renderMetrics.memory.value / 1024 / 1024).toFixed(0) + "MB" : "—"}`}
          open={openSet.has("hosting")}
          onToggle={toggleSection}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontWeight: 400, letterSpacing: "0.01em" }}>Window</div>
            <div style={{ display: "flex", gap: 2, background: HOME_THEME.panelBg, borderRadius: 6, padding: 2 }}>
              {(["live", "weekly", "monthly"] as const).map(w => (
                <button
                  key={w}
                  onClick={() => void fetchRenderWindow(w)}
                  disabled={renderLoading}
                  style={{
                    padding: "3px 10px",
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 4,
                    border: "none",
                    cursor: renderLoading ? "wait" : "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    background: renderWindow === w ? "rgba(255,255,255,0.07)" : "transparent",
                    color: renderWindow === w ? HOME_THEME.cyan : HOME_THEME.text,
                    opacity: renderWindow === w ? 1 : 0.5,
                  }}
                >
                  {w === "live" ? "Live" : w === "weekly" ? "7 Day" : "30 Day"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(1, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))", gap: 10, opacity: renderLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
            <StatCard
              label={`CF Egress · ${renderWindow === "live" ? "24h" : renderWindow === "weekly" ? "7d" : "30d"}`}
              value={cfMetrics?.egress.value != null
                ? cfMetrics.egress.value < 1024
                  ? `${cfMetrics.egress.value.toFixed(1)} MB`
                  : cfMetrics.egress.value < 1024 * 1024
                    ? `${(cfMetrics.egress.value / 1024).toFixed(2)} GB`
                    : `${(cfMetrics.egress.value / 1024 / 1024).toFixed(2)} TB`
                : cfMetrics?.unconfigured
                  ? "Setup needed"
                  : "—"}
              accent={HOME_THEME.orange}
              mono
              footer={cfMetrics?.unconfigured && cfMetrics.egress.value == null
                ? <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, lineHeight: 1.4 }}>Set <b style={{ color: HOME_THEME.orange }}>CLOUDFLARE_API_TOKEN</b> + <b style={{ color: HOME_THEME.orange }}>CLOUDFLARE_ZONE_ID</b> in <code>.env.local</code></div>
                : <Sparkline
                    data={cfMetrics?.egress.spark ?? []}
                    accent={HOME_THEME.orange}
                    height={44}
                    durationMs={renderWindow === "live" ? 86_400_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000}
                    endIso={cfMetrics?.fetchedAt}
                    formatValue={(v) => v < 1024 ? `${v.toFixed(1)} MB` : v < 1024 * 1024 ? `${(v / 1024).toFixed(2)} GB` : `${(v / 1024 / 1024).toFixed(2)} TB`}
                    axisLabels={sparkTimeLabels(
                      renderWindow === "live" ? 86_400_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000,
                      cfMetrics?.fetchedAt
                    )}
                  />}
            />
            <StatCard
              label={`Host Net · ${renderWindow === "live" ? "1h" : renderWindow === "weekly" ? "7d" : "30d"}`}
              value={renderMetrics?.bandwidth.value != null
                ? renderMetrics.bandwidth.value < 1024
                  ? `${renderMetrics.bandwidth.value.toFixed(1)} MB`
                  : `${(renderMetrics.bandwidth.value / 1024).toFixed(2)} GB`
                : renderMetrics?.unconfigured
                  ? "Setup needed"
                  : "—"}
              accent={HOME_THEME.cyan}
              mono
              footer={renderMetrics?.unconfigured && renderMetrics.bandwidth.value == null
                ? <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, lineHeight: 1.4 }}>Set <b style={{ color: HOME_THEME.cyan }}>HETZNER_API_TOKEN</b> + <b style={{ color: HOME_THEME.cyan }}>HETZNER_SERVER_ID</b> in <code>.env.local</code></div>
                : <Sparkline
                    data={renderMetrics?.bandwidth.spark ?? []}
                    accent={HOME_THEME.cyan}
                    height={44}
                    durationMs={renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000}
                    endIso={renderMetrics?.fetchedAt}
                    formatValue={(v) => v < 1024 ? `${v.toFixed(1)} MB` : `${(v / 1024).toFixed(2)} GB`}
                    axisLabels={sparkTimeLabels(
                      renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000,
                      renderMetrics?.fetchedAt
                    )}
                  />}
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
              footer={<Sparkline
                data={renderMetrics?.memory.spark ?? []}
                accent={memAccent}
                height={44}
                durationMs={renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000}
                endIso={renderMetrics?.fetchedAt}
                formatValue={(v) => v < 1024 * 1024 ? `${(v / 1024).toFixed(0)} KB` : `${(v / 1024 / 1024).toFixed(0)} MB`}
                axisLabels={sparkTimeLabels(
                  renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000,
                  renderMetrics?.fetchedAt
                )}
              />}
            />
            <StatCard
              label={`CPU · ${renderWindow === "live" ? "Latest" : renderWindow === "weekly" ? "7d Avg" : "30d Avg"}`}
              value={renderMetrics?.cpu.value != null
                ? `${(renderMetrics.cpu.value * 100).toFixed(1)}%`
                : "—"}
              accent={cpuAccent}
              mono
              footer={<Sparkline
                data={renderMetrics?.cpu.spark ?? []}
                accent={cpuAccent}
                height={44}
                durationMs={renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000}
                endIso={renderMetrics?.fetchedAt}
                formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                axisLabels={sparkTimeLabels(
                  renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000,
                  renderMetrics?.fetchedAt
                )}
              />}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text, opacity: 1, letterSpacing: "0.01em" }}>Updated</span>
              <span style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 1 }}>
                {renderMetrics?.fetchedAt
                  ? new Date(renderMetrics.fetchedAt).toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" }) + " ET"
                  : "—"}
              </span>
            </div>
          </div>

          {/* WS outbound — in-app per-frame bandwidth (the gex-vs-flow split the
              host bandwidth card can't show). Live trailing-60s window. */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, opacity: 1, letterSpacing: "0.01em" }}>
                /ws/gex Outbound · Live (last 60s)
              </div>
              <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 1 }}>
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
                spot: HOME_THEME.green, aux: HOME_THEME.cyan, status: HOME_THEME.text, esCandles: HOME_THEME.purple,
              };
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
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
                        accent={ACCENT[t] ?? HOME_THEME.text}
                        mono
                        footer={
                          <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 1 }}>
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
                          fontSize: 14, fontFamily: "var(--font-mono)", fontWeight: 700,
                          color: ACCENT[t] ?? HOME_THEME.text,
                          border: `1px solid ${ACCENT[t] ?? HOME_THEME.text}44`,
                          background: `${ACCENT[t] ?? HOME_THEME.text}10`,
                          padding: "3px 8px", borderRadius: 5,
                        }}>
                          {KNOWN.includes(t) ? t : `${t}?`} {fmtRate(b)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, marginTop: 8, lineHeight: 1.5 }}>
                    Projected from the trailing 60s × open clients. If <b style={{ color: HOME_THEME.orange }}>FLOW</b> dominates and the
                    number is high while the market is closed, the flow-tape dedupe regressed. Cross-check Cloudflare Outbound.
                  </div>
                </>
              );
            })()}
          </div>
        </AccordionCard>
        )}

        {/* ── Database tab removed — all DB surfaces live on the backend /database page ── */}

        {/* ── Controls ── */}
        {SECTION_TAB.controls === ownerTab && (
        <AccordionCard
          accent="#3FB8A0"
          id="controls"
          title="Controls"
          subtitle={`idle ${isIdle == null ? "—" : isIdle ? "ON" : "OFF"} · mvc ${mvcAuto == null ? "—" : mvcAuto ? "ON" : "OFF"} · maint ${maint == null ? "—" : maint ? "ON" : "OFF"}`}
          open={openSet.has("controls")}
          onToggle={toggleSection}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* SPX index-feed health (frozen-spot detector) + quick link to the page */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 260 }}><SpotFeedHealth /></div>
              <a href="/greeks" style={{ ...homeSecondaryButtonStyle, padding: "8px 16px", borderRadius: 8, textDecoration: "none", fontSize: 14, whiteSpace: "nowrap" }}>
                Open Greeks →
              </a>
            </div>
            {/* theta-terminal container health (cpu/mem/pids) — live docker stats */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 260 }}><ThetaTerminalStats /></div>
            </div>
            {/* Toggles */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              {/* Idle */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Idle Mode (feed)</span>
                <button
                  onClick={toggleIdle}
                  disabled={ctlBusy === "idle"}
                  title="Pause/resume the live TT/dxLink feed. Idle ON stops recompute, flow, OI, and candle timers."
                  style={{
                    ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 14,
                    opacity: ctlBusy === "idle" ? 0.6 : 1,
                    cursor: ctlBusy === "idle" ? "wait" : "pointer",
                  }}
                >
                  {ctlBusy === "idle" ? "…" : isIdle == null ? "—" : isIdle ? "● Idle ON — resume" : "○ Idle OFF — pause"}
                </button>
              </div>
              {/* MVC auto */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>CB Auto (5m)</span>
                <button
                  onClick={toggleMvcAuto}
                  disabled={ctlBusy === "mvcAuto"}
                  title="Enable/disable the in-process CB - Core Bullseye auto-collector (writes mvc_snapshots every 5m during RTH)."
                  style={{
                    ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 14,
                    opacity: ctlBusy === "mvcAuto" ? 0.6 : 1,
                    cursor: ctlBusy === "mvcAuto" ? "wait" : "pointer",
                  }}
                >
                  {ctlBusy === "mvcAuto" ? "…" : mvcAuto == null ? "—" : mvcAuto ? "● Auto ON — disable" : "○ Auto OFF — enable"}
                </button>
              </div>
              {/* Maintenance mode */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Maintenance</span>
                <button
                  onClick={toggleMaint}
                  disabled={ctlBusy === "maint"}
                  title="When ON, all non-owner users are redirected to the maintenance page. You (owner) keep full access."
                  style={{
                    ...homeButtonStyle, padding: "7px 18px", borderRadius: 8, fontSize: 14,
                    opacity: ctlBusy === "maint" ? 0.6 : 1,
                    cursor: ctlBusy === "maint" ? "wait" : "pointer",
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
                style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "reconnect" ? 0.6 : 1, cursor: ctlBusy === "reconnect" ? "wait" : "pointer" }}
              >
                {ctlBusy === "reconnect" ? "Reconnecting…" : "↻ Reconnect Feed"}
              </button>
              <button
                onClick={doEodRun}
                disabled={ctlBusy === "eod"}
                title="Manually fire the EOD GEX recorder for $SPX/SPY/QQQ (in case the 3:55–4:05 ET window was missed)."
                style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "eod" ? 0.6 : 1, cursor: ctlBusy === "eod" ? "wait" : "pointer" }}
              >
                {ctlBusy === "eod" ? "Recording…" : "▶ Run EOD GEX now"}
              </button>
              <button
                onClick={doMvcSnapshot}
                disabled={ctlBusy === "mvcSnap"}
                title="Write a single CB - Core Bullseye snapshot right now (overrides the outside-RTH guard; still needs a live chain)."
                style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "mvcSnap" ? 0.6 : 1, cursor: ctlBusy === "mvcSnap" ? "wait" : "pointer" }}
              >
                {ctlBusy === "mvcSnap" ? "Snapshotting (may reconnect)…" : "📸 CB Snapshot now"}
              </button>
              <button
                onClick={doPremarketRun}
                disabled={ctlBusy === "premarket"}
                title="Generate the Analytics Premarket card's 5-bullet AI summary now (instead of waiting for the ~8am ET run)."
                style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "premarket" ? 0.6 : 1, cursor: ctlBusy === "premarket" ? "wait" : "pointer" }}
              >
                {ctlBusy === "premarket" ? "Generating…" : "📝 Premarket Summary now"}
              </button>
              <button
                onClick={doStrategyRun}
                disabled={ctlBusy === "strategy"}
                title="Generate the Analytics Strategy Builder card's full daily AI plan now (instead of waiting for the hourly run)."
                style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "strategy" ? 0.6 : 1, cursor: ctlBusy === "strategy" ? "wait" : "pointer" }}
              >
                {ctlBusy === "strategy" ? "Generating…" : "🎯 Strategy now"}
              </button>
              <button
                onClick={doClearChat}
                disabled={ctlBusy === "clearChat"}
                title="Permanently delete ALL subscriber chat messages. Cannot be undone."
                style={{ ...homeButtonStyle, padding: "7px 16px", borderRadius: 8, fontSize: 14, opacity: ctlBusy === "clearChat" ? 0.6 : 1, cursor: ctlBusy === "clearChat" ? "wait" : "pointer" }}
              >
                {ctlBusy === "clearChat" ? "Erasing…" : "🗑️ Erase all chat"}
              </button>
            </div>

            {/* Result message */}
            {ctlMsg && (
              <div style={{
                fontSize: 14, fontFamily: "var(--font-mono)", padding: "8px 10px", borderRadius: 8,
                background: ctlMsg.ok ? "rgba(255,255,255,0.05)" : "rgba(239,68,68,0.10)",
                border: `1px solid ${ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red}44`,
                color: ctlMsg.ok ? HOME_THEME.green : HOME_THEME.red,
              }}>
                {ctlMsg.ok ? "✓ " : "✗ "}{ctlMsg.text}
              </div>
            )}

            {/* ── Signal Alerts — live per-kind toggles for the background trade-signal
                engine (Discord "CB Edge Signals"). DB-backed; a flip here takes effect
                within ~20s, no redeploy. Replaces the old compile-time env kill switches. */}
            <div style={{ borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text }}>Signal Alerts</span>
                <span style={{ fontSize: 14, color: HOME_THEME.textMuted }}>
                  on/off per alert type for the background signals engine → Discord. No redeploy needed.
                </span>
              </div>
              {!signalAlerts ? (
                <span style={{ fontSize: 14, color: HOME_THEME.textMuted }}>Loading…</span>
              ) : (() => {
                const masterEnabled = signalAlerts.find((r) => r.key === "bzila_confluence")?.enabled ?? true;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {signalAlerts.map((row) => {
                      const isBzilaSub = row.group === "bzila" && row.key !== "bzila_confluence";
                      const dimmed = isBzilaSub && !masterEnabled;
                      const busy = signalAlertsBusy === row.key;
                      return (
                        <div
                          key={row.key}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            paddingLeft: isBzilaSub ? 22 : 0,
                            opacity: dimmed ? 0.45 : 1,
                          }}
                        >
                          <button
                            onClick={() => toggleSignalAlert(row.key, row.enabled)}
                            disabled={busy}
                            title={
                              row.key === "bzila_confluence"
                                ? "Master switch — must be ON for any Bzila sub-setup below to fire."
                                : isBzilaSub
                                ? "Independently toggleable, but only fires while the Bzila Confluence master switch above is also ON."
                                : undefined
                            }
                            style={{
                              ...homeButtonStyle, padding: "4px 12px", borderRadius: 7, fontSize: 14,
                              minWidth: 74, textAlign: "center",
                              opacity: busy ? 0.6 : 1,
                              cursor: busy ? "wait" : "pointer",
                              background: row.enabled ? homeButtonStyle.background : "rgba(255,255,255,0.04)",
                            }}
                          >
                            {busy ? "…" : row.enabled ? "● ON" : "○ OFF"}
                          </button>
                          <span style={{ fontSize: 14, color: HOME_THEME.text }}>{row.label}</span>
                          <span
                            style={{
                              fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase",
                              padding: "2px 7px", borderRadius: 5,
                              color: row.group === "bzila" ? HOME_THEME.cyan : HOME_THEME.textMuted,
                              border: `1px solid ${row.group === "bzila" ? HOME_THEME.cyan : HOME_THEME.border}66`,
                            }}
                          >
                            {row.group}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </AccordionCard>
        )}

        {/* ── EOD GEX save status moved to the backend /database page ── */}

        {/* ── Levels auto-publish moved to Estimated Moves → EM Tracker tab ── */}
        {/* Section relocated to /estimated-move (EM Tracker tab) — see components/dashboard/LevelsPublish.tsx */}
        {false && (
        <div style={{ ...homePanelStyle }}>
          {!levelsCollapsed && <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <StatusBadge
                ok={!levelsAreStale(levels.lastRun)}
                label={levels.lastRun ? (levelsAreStale(levels.lastRun) ? "Stale" : "Current") : "Never run"}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Last Published</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>{fmtLastRun(levels.lastRun)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>EM Grabbed</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>{fmtLastRun(levels.emGrabbed)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Tickers</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>{levels.count}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: HOME_THEME.text, letterSpacing: "0.01em" }}>Schedule</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: HOME_THEME.text, fontFamily: "var(--font-mono)" }}>Sat ~09:00 ET</span>
              </div>
              <button
                onClick={triggerPublish}
                disabled={publishing || pubRun.running}
                title="Compute & publish weekly EM levels for the whole roster now (takes a few minutes for ~370 tickers). Overwrites the current weekly snapshot."
                style={{
                  ...homeButtonStyle,
                  padding: "6px 16px",
                  borderRadius: 8,
                  fontSize: 14,
                  marginLeft: "auto",
                  opacity: (publishing || pubRun.running) ? 0.6 : 1,
                  cursor: (publishing || pubRun.running) ? "not-allowed" : "pointer",
                }}
              >
                {(publishing || pubRun.running) ? "Publishing…" : "Publish Now"}
              </button>
              <a href="/database" style={{ ...homeSecondaryButtonStyle, padding: "6px 14px", borderRadius: 8, textDecoration: "none", fontSize: 14 }}>
                View table →
              </a>
            </div>

            {/* Last manual/weekly run result */}
            {(pubRun.running || pubRun.at) && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 14, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${HOME_THEME.border}` }}>
                {pubRun.running ? (
                  <span style={{ fontWeight: 500, color: HOME_THEME.cyan }}>● Running… computing levels (this can take a few minutes)</span>
                ) : (
                  <>
                    <span style={{ fontWeight: 500, color: pubRun.error ? HOME_THEME.red : HOME_THEME.green }}>
                      {pubRun.error ? "✗ Failed" : "✓ Last run OK"}
                    </span>
                    {pubRun.emTotal != null && (
                      <span style={{ color: HOME_THEME.text, fontFamily: "var(--font-mono)" }}>
                        EM <b style={{ color: (pubRun.failedEm.length ? HOME_THEME.orange : HOME_THEME.green) }}>{pubRun.emOk}/{pubRun.emTotal}</b>
                        {pubRun.posted != null ? <> · {pubRun.posted} rows</> : null}
                      </span>
                    )}
                    {pubRun.ms != null && <span style={{ color: HOME_THEME.text, opacity: 1 }}>in {Math.round((pubRun.ms ?? 0) / 1000)}s</span>}
                    {pubRun.at && <span style={{ color: HOME_THEME.text, opacity: 1 }}>{fmtLastRun(pubRun.at)}</span>}
                    {pubRun.reason && <span style={{ color: HOME_THEME.text, opacity: 1 }}>({pubRun.reason})</span>}
                    {pubRun.error && <span style={{ color: HOME_THEME.red }}>{pubRun.error}</span>}
                  </>
                )}
              </div>
            )}
            {!pubRun.running && pubRun.failedEm.length > 0 && (
              <div style={{ fontSize: 14, color: HOME_THEME.orange, lineHeight: 1.6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <b>No EM priced ({pubRun.failedEm.length}):</b>
                  <button
                    onClick={triggerRetry}
                    disabled={retrying || publishing}
                    style={{
                      fontSize: 14, fontWeight: 500, padding: "3px 10px", borderRadius: 6, cursor: (retrying || publishing) ? "default" : "pointer",
                      color: (retrying || publishing) ? `${HOME_THEME.text}` : "#000",
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
                    <b style={{ color: HOME_THEME.text }}>{f.ticker}</b>
                    {f.reason ? <span style={{ color: HOME_THEME.text, opacity: 1 }}> ({f.reason})</span> : null}
                  </span>
                ))}
                <div style={{ color: HOME_THEME.text, opacity: 1, marginTop: 3 }}>
                  Usually illiquid / no quoted weekly straddle, or after-hours. Retry once liquidity returns.
                </div>
              </div>
            )}
            {levels.tickers.length > 0 && (
              <>
                {levels.tickers.some((t) => t.stale) && (
                  <div style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.orange, display: "flex", alignItems: "center", gap: 6 }}>
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
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: copyingAll ? "wait" : "pointer",
                      color: copiedTicker === "__ALL__" ? HOME_THEME.green : HOME_THEME.cyan,
                      background: copiedTicker === "__ALL__" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${copiedTicker === "__ALL__" ? HOME_THEME.green + "66" : HOME_THEME.cyan + "66"}`,
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontFamily: "var(--font-mono)",
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
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        color: copied ? HOME_THEME.text : `${HOME_THEME.muted}99`,
                        background: copied ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                        border: `1px solid ${copied ? HOME_THEME.cyan + "88" : HOME_THEME.border}`,
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontFamily: "var(--font-mono)",
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
        )}

        {/* Auth tab removed — all activity/user metrics now consolidated on Overview tab. */}


      </div>
      </div>
    </div>
  );
}
