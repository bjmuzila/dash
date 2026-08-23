

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LiveKpiCard,
  useLiveSeries,
  type LivePoint,
} from "../components/LiveKpiCard";
import AcquisitionPanel from "../components/AcquisitionPanel";
import CampaignLinkBuilder from "../components/CampaignLinkBuilder";
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
// country/region/city come from Cloudflare's visitor-location headers and stay
// null on rows logged before that managed transform was switched on.
interface PageVisit {
  id?: number;
  pageKey: string | null;
  pageLabel: string | null;
  path: string | null;
  userId: string | null;
  ip: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  /** City-centroid coords from Cloudflare — what the map's bubbles plot. */
  lat?: number | null;
  lon?: number | null;
  /**
   * The registered account behind the row. `userId` non-null = REGISTERED, and
   * that — not isSubscriber — is what splits Members from Non-members in the
   * Top-pages card. /api/page-status fills it from the session cookie, so a
   * logged-out visitor is the only thing that lands on the non-member side,
   * which is the only honest reading: every gated page is unreachable without
   * a session, so "non-member traffic on /es-candles" is a contradiction.
   */
  userEmail?: string | null;
  userName?: string | null;
  /** When that account was created — how a campaign click is tied to a signup. */
  userCreatedAt?: string | null;
  /**
   * PAYING — 'active' | 'trialing' per libDb.PAID_STATUSES. Tracked as a SUBSET
   * of registered, never as the member test itself: registered-but-not-paying
   * is the trial funnel and is worth being able to see.
   */
  isSubscriber?: boolean | null;
  subStatus?: string | null;
  /** Brandon's own visits. Excluded from the Top-pages card, and counted so it can say so. */
  isOwner?: boolean | null;
  // ── Acquisition ──────────────────────────────────────────────────────────
  // Non-null only on ENTRY rows (the first beacon of a browser session) — see
  // lib/visitorAttribution.ts. Sessions = rows with isEntry; every other row is
  // a pageview with null attribution. Never mix the two denominators.
  isEntry?: boolean | null;
  referrer?: string | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  channel?: string | null;
  // Device is filled on EVERY row (it comes from the User-Agent header).
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  isBot?: boolean | null;
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

// Sparkline / StatCard / pctDelta / sparkTimeLabels all retired here: the
// cards that used them now render <LiveKpiCard>, which does its own curve,
// axis labels, crosshair tooltip and delta pill.

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

// ── Fast ET bucket keys ──────────────────────────────────────────────────────
//
// WHY THIS EXISTS: every bucketing pass below runs over the whole page_visits
// log (tens of thousands of rows). The obvious way to write them —
// `d.toLocaleDateString("en-CA", { timeZone: ET_TZ })` per row — builds a fresh
// Intl.DateTimeFormat on EVERY call, and that construction, not the formatting,
// is what costs. At ~20k rows × half a dozen passes (KPI strip, metrics tabs,
// "on today", the daily series) that was hundreds of thousands of Intl
// constructions per render: whole seconds of blocked main thread, felt as the
// Overview tab hanging when the traffic / pages-visited cards come in.
//
// The offset of America/New_York from UTC only changes at DST boundaries, and
// those land on an hour mark. So ONE Intl lookup per UTC hour answers for every
// row inside that hour — 30 days of visits touch ~720 buckets instead of 20,000
// formats — and every key after that is integer arithmetic on a shifted
// timestamp. Identical strings out, orders of magnitude less work.

const ET_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});
const ET_DAY_LABEL_FMT = new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, weekday: "short", day: "numeric" });
const ET_HOUR_LABEL_FMT = new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, hour: "numeric", hour12: true });

const ET_OFFSET_CACHE = new Map<number, number>();

/** ET's UTC offset (ms) at an instant, cached per UTC hour. */
function etOffsetMs(ms: number): number {
  const bucket = Math.floor(ms / 3_600_000);
  const hit = ET_OFFSET_CACHE.get(bucket);
  if (hit !== undefined) return hit;
  const parts = ET_PARTS_FMT.formatToParts(new Date(ms));
  let y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0;
  for (const p of parts) {
    const n = Number(p.value);
    if (p.type === "year") y = n;
    else if (p.type === "month") mo = n;
    else if (p.type === "day") d = n;
    else if (p.type === "hour") h = n % 24;
    else if (p.type === "minute") mi = n;
    else if (p.type === "second") s = n;
  }
  const off = Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000;
  ET_OFFSET_CACHE.set(bucket, off);
  return off;
}

/** Epoch ms shifted so the UTC getters of `new Date(x)` read as ET wall clock. */
function etShift(ms: number): number {
  return ms + etOffsetMs(ms);
}

const pad2 = (n: number): string => (n < 10 ? "0" + n : "" + n);

/** YYYY-MM-DD in ET, from epoch ms. */
function etDayKeyMs(ms: number): string {
  const d = new Date(etShift(ms));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** YYYY-MM-DD HH in ET, from epoch ms. */
function etHourKeyMs(ms: number): string {
  const d = new Date(etShift(ms));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}`;
}

/** Calendar year in ET, from epoch ms. */
function etYearMs(ms: number): number {
  return new Date(etShift(ms)).getUTCFullYear();
}

/** YYYY-MM-DD in ET for a Date (so day buckets line up with the trading day). */
function etDayKey(d: Date): string {
  return etDayKeyMs(d.getTime());
}

/** "Mon 23" style short label for a day-bucket axis tick. */
function etDayLabel(d: Date): string {
  return ET_DAY_LABEL_FMT.format(d);
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
    const t = Date.parse(v.createdAt);
    if (!Number.isFinite(t)) continue;
    const k = etDayKeyMs(t);
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

// The hourly load heatmap was dropped from this tab on 2026-08-23.
// components/HourlyHeatmap.tsx is no longer mounted anywhere.

/**
 * Bucket signups (Clerk recent users, by createdAt ms) into the last `days`
 * calendar days (ET), oldest → newest. Same shape as dailyVisitSeries so the
 * rolling-7-day cumulative-users chart can share its rendering.
 */
function dailySignupSeries(signups: Array<{ createdAt: number | null }>, days = 7): { counts: number[]; labels: string[] } {
  const byDay = new Map<string, number>();
  for (const s of signups) {
    if (s.createdAt == null) continue;
    const t = new Date(s.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    const k = etDayKeyMs(t);
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
  const weekStart = new Date(); // reused across rows — no per-row allocation
  for (const v of visits) {
    if (!v.createdAt) continue;
    const t = Date.parse(v.createdAt);
    if (!Number.isFinite(t)) continue;
    weekStart.setTime(t);
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
    const t = Date.parse(v.createdAt);
    if (!Number.isFinite(t)) continue;
    const k = etDayKeyMs(t).slice(0, 7); // YYYY-MM
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

// ─── Overview granularity ─────────────────────────────────────────────────────
// One control in the page header drives every card on the Overview tab, so the
// KPI strip, the traffic/signup charts and the cumulative curve always describe
// the same span. Same four steps and the same pill styling as the Sales page.

export type OverviewGran = "live" | "daily" | "weekly" | "monthly" | "yearly";

/** Every consumer maps the shared granularity onto its own nearest supported
 *  window. Hetzner/Cloudflare only expose live/7d/30d, so yearly folds back to
 *  monthly there rather than showing an empty chart. */
export const HOSTING_WINDOW: Record<OverviewGran, "live" | "weekly" | "monthly"> = {
  live: "live",
  daily: "live",
  weekly: "weekly",
  monthly: "monthly",
  yearly: "monthly",
};

function GranTabs({ value, onChange }: { value: OverviewGran; onChange: (g: OverviewGran) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: 3 }}>
      {(["live", "daily", "weekly", "monthly", "yearly"] as const).map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          style={{
            padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 14, fontWeight: 700, textTransform: "capitalize", fontFamily: "inherit",
            background: value === g ? HOME_THEME.cyan : "transparent",
            color: value === g ? "#04141a" : HOME_THEME.text,
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

/** Last 24 hours in one-hour ET buckets — the "live" step. Finer than daily,
 *  and the only window where you can see today's shape as it happens. */
function hourlyVisitSeries(visits: PageVisit[], hours = 24): { counts: number[]; labels: string[] } {
  return hourBuckets(visits.map((v) => v.createdAt), hours);
}

function hourlySignupSeries(signups: Array<{ createdAt: number | null }>, hours = 24): { counts: number[]; labels: string[] } {
  return hourBuckets(signups.map((s) => s.createdAt), hours);
}

function hourBuckets(stamps: Array<string | number | null | undefined>, hours: number): { counts: number[]; labels: string[] } {
  const byHour = new Map<string, number>();
  for (const raw of stamps) {
    if (raw == null) continue;
    const t = typeof raw === "number" ? raw : Date.parse(raw);
    if (!Number.isFinite(t)) continue;
    // Keyed ONCE per row. The old version formatted the same timestamp twice
    // (map read + map write), doubling the cost of the hottest loop on the tab.
    const k = etHourKeyMs(t);
    byHour.set(k, (byHour.get(k) ?? 0) + 1);
  }
  const counts: number[] = [];
  const labels: string[] = [];
  const now = Date.now();
  for (let i = hours - 1; i >= 0; i--) {
    const at = now - i * 3_600_000;
    counts.push(byHour.get(etHourKeyMs(at)) ?? 0);
    labels.push(ET_HOUR_LABEL_FMT.format(new Date(at)).replace(" ", ""));
  }
  return { counts, labels };
}

/** Calendar-year buckets, oldest first. Yearly is "lifetime" — it spans from
 *  the first year that has data through the current one, so the axis grows by
 *  one bucket a year instead of showing a fixed rolling window. */
function yearlyVisitSeries(visits: PageVisit[]): { counts: number[]; labels: string[] } {
  const byYear = new Map<number, number>();
  for (const v of visits) {
    if (v.createdAt == null) continue;
    const t = Date.parse(v.createdAt);
    if (!Number.isFinite(t)) continue;
    const y = etYearMs(t);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  return yearBuckets(byYear);
}

function yearlySignupSeries(signups: Array<{ createdAt: number | null }>): { counts: number[]; labels: string[] } {
  const byYear = new Map<number, number>();
  for (const s of signups) {
    if (s.createdAt == null) continue;
    const t = new Date(s.createdAt);
    if (isNaN(t.getTime())) continue;
    byYear.set(t.getFullYear(), (byYear.get(t.getFullYear()) ?? 0) + 1);
  }
  return yearBuckets(byYear);
}

function yearBuckets(byYear: Map<number, number>): { counts: number[]; labels: string[] } {
  const nowYear = new Date().getFullYear();
  const years = [...byYear.keys()];
  const first = years.length ? Math.min(Math.min(...years), nowYear) : nowYear;
  const counts: number[] = [];
  const labels: string[] = [];
  for (let y = first; y <= nowYear; y++) {
    counts.push(byYear.get(y) ?? 0);
    labels.push(String(y));
  }
  return { counts, labels };
}

/** The visit/signup series for a granularity, plus the caption describing the
 *  window. One place to change if a window length ever moves. */
function seriesFor(gran: OverviewGran, visits: PageVisit[], signups: Array<{ createdAt: number | null }>) {
  if (gran === "yearly") {
    return { traffic: yearlyVisitSeries(visits), signups: yearlySignupSeries(signups), caption: "lifetime" };
  }
  if (gran === "monthly") {
    return { traffic: monthlyVisitSeries(visits, 12), signups: monthlySignupSeries(signups, 12), caption: "12 months" };
  }
  if (gran === "weekly") {
    return { traffic: weeklyVisitSeries(visits, 12), signups: weeklySignupSeries(signups, 12), caption: "12 weeks" };
  }
  if (gran === "daily") {
    return { traffic: dailyVisitSeries(visits, 7), signups: dailySignupSeries(signups, 7), caption: "7 days" };
  }
  return { traffic: hourlyVisitSeries(visits, 24), signups: hourlySignupSeries(signups, 24), caption: "24 hours" };
}

/**
 * Tabbed metrics section — shows Traffic, Signups, and Cumulative Users
 * with daily/weekly/monthly time period tabs (defaults to daily).
 */
function MetricsTabSection({
  visits, signups, users, activeSessions, period
}: {
  visits: PageVisit[];
  signups: Array<{ createdAt: number | null }>;
  users: number | null;
  activeSessions: number | null;
  /** Owned by the page header now, not by this section. */
  period: OverviewGran;
}) {
  const isMobile = useIsMobile();

  // MEMOISED: this buckets the entire visit log. Without the memo it re-ran on
  // every render of this section — including the ones caused by a hosting-metrics
  // poll that changes nothing here — and each run walked ~20k rows.
  const { traffic, signups: signupsSeries, caption } = useMemo(
    () => seriesFor(period, visits, signups),
    [period, visits, signups],
  );

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Window caption — the picker itself lives in the page header. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7, fontFamily: "var(--font-mono)" }}>
          {caption}
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

/** Turn a raw sample array into chart points, mapping each index back to a real
 *  timestamp so the crosshair reads a time rather than an index. */
function sparkPoints(data: number[] | undefined, durationMs: number, endIso?: string | null): LivePoint[] {
  if (!data?.length) return [];
  const end = endIso ? new Date(endIso).getTime() : NaN;
  return data.map((value, i) => {
    if (isNaN(end)) return { value };
    const t = end - durationMs + (data.length > 1 ? (i / (data.length - 1)) * durationMs : durationMs);
    const d = new Date(t);
    return {
      value,
      label: durationMs > 36 * 3_600_000
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET_TZ })
        : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: ET_TZ }),
    };
  });
}

/** Server health tiles, formerly the Infra tab's "System" card.
 *
 *  Only the five that actually get looked at survived the move — uptime, feed
 *  freshness, the two feed-connection states and the deployed version. Last
 *  Feed is the one with a real curve: it's a live age-in-seconds, so a rising
 *  line is exactly what a stalling feed looks like. The rest are states, not
 *  series, so they render as plain tiles. */
function SystemStrip({
  isMobile, displayUptime, lastFeedAgo, dxLinkState, dxOk, ttAuthenticated, ttOk,
}: {
  isMobile: boolean;
  displayUptime: number | undefined;
  lastFeedAgo: number | null;
  dxLinkState: string | undefined;
  dxOk: boolean;
  ttAuthenticated: boolean | undefined;
  ttOk: boolean;
}) {
  // Age-in-seconds since the last feed tick, accumulated across polls.
  const feedSeries = useLiveSeries(lastFeedAgo, 60);
  const feedHealthy = lastFeedAgo != null && lastFeedAgo < 10;
  // Connection states as 1/0 over time. A flat line at the top is a solid
  // session; the dips are the flaps you'd otherwise only catch by staring at
  // the tile at the exact wrong moment.
  const dxSeries = useLiveSeries(dxLinkState == null ? null : dxOk ? 1 : 0, 60);
  const ttSeries = useLiveSeries(ttAuthenticated == null ? null : ttOk ? 1 : 0, 60);
  const upDown = (v: number) => (v >= 0.5 ? "up" : "down");

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(5, minmax(0,1fr))", gap: 10 }}>
      <LiveKpiCard
        label="Server Uptime"
        value={displayUptime != null ? fmtUptime(displayUptime) : "—"}
        sub="since last restart"
        accent={HOME_THEME.green}
        delta={null}
      />
      <LiveKpiCard
        label="Last Feed"
        value={lastFeedAgo != null ? `${lastFeedAgo}s` : "—"}
        sub="since last tick"
        accent={feedHealthy ? HOME_THEME.green : HOME_THEME.orange}
        points={feedSeries}
        formatValue={(v) => `${Math.round(v)}s`}
        // Rising age is bad here, so a positive delta should read red.
        invertDelta
        height={52}
        showAxes={false}
      />
      <LiveKpiCard
        label="dxLink Feed"
        value={dxLinkState || "—"}
        sub="TT → Proxy"
        accent={dxOk ? HOME_THEME.green : HOME_THEME.red}
        points={dxSeries}
        formatValue={upDown}
        delta={null}
        height={52}
        showAxes={false}
      />
      <LiveKpiCard
        label="TT Auth"
        value={ttAuthenticated == null ? "—" : ttOk ? "OK" : "FAIL"}
        sub="tastytrade session"
        accent={ttOk ? HOME_THEME.green : HOME_THEME.red}
        points={ttSeries}
        formatValue={upDown}
        delta={null}
        height={52}
        showAxes={false}
      />
      <LiveKpiCard
        label="Version"
        value={(import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION || "—"}
        sub="deployed build"
        accent={HOME_THEME.orange}
        delta={null}
      />
    </div>
  );
}

/** Hetzner + Cloudflare usage, formerly the Infra tab's "Hosting" card.
 *
 *  Keeps its own live/7d/30d switcher rather than following the page's
 *  daily/weekly/monthly/yearly control: those are different time concepts, and
 *  the upstream APIs only expose these three windows (there is no yearly). */
function HostingStrip({
  isMobile, renderMetrics, cfMetrics, renderWindow, renderLoading, onWindow, memAccent, cpuAccent, gran,
}: {
  isMobile: boolean;
  renderMetrics: RenderMetrics | null;
  cfMetrics: CfMetrics | null;
  renderWindow: "live" | "weekly" | "monthly";
  renderLoading: boolean;
  onWindow: (w: "live" | "weekly" | "monthly") => void;
  memAccent: string;
  cpuAccent: string;
  gran: OverviewGran;
}) {
  // No toolbar of its own any more — the page header's control is the single
  // time-frame switch for the whole tab. Refetch whenever the mapped upstream
  // window actually changes, not on every granularity step (daily and live both
  // map to the same Hetzner/CF window, so stepping between them is free).
  const wanted = HOSTING_WINDOW[gran];
  useEffect(() => {
    if (wanted !== renderWindow) onWindow(wanted);
    // onWindow identity is stable (useCallback in the parent); depending on
    // renderWindow here would re-fire mid-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const hostMs = renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000;
  const cfMs = renderWindow === "live" ? 86_400_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000;
  const winLabel = renderWindow === "live" ? "24h" : renderWindow === "weekly" ? "7d" : "30d";
  const hostLabel = renderWindow === "live" ? "1h" : renderWindow === "weekly" ? "7d" : "30d";

  const fmtMb = (v: number) => v < 1024 ? `${v.toFixed(1)} MB` : v < 1024 * 1024 ? `${(v / 1024).toFixed(2)} GB` : `${(v / 1024 / 1024).toFixed(2)} TB`;
  const fmtBytes = (v: number) => v < 1024 * 1024 ? `${(v / 1024).toFixed(0)} KB` : `${(v / 1024 / 1024).toFixed(0)} MB`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.45 }}>
          Hosting · Hetzner + Cloudflare
        </span>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono), monospace", color: HOME_THEME.text, opacity: 0.35 }}>
          {gran === "yearly" ? "30 day — no yearly upstream" : renderWindow === "live" ? "live window" : renderWindow === "weekly" ? "7 day window" : "30 day window"}
        </span>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(4, minmax(0,1fr))",
        gap: 10, opacity: renderLoading ? 0.5 : 1, transition: "opacity 0.2s",
      }}>
        <LiveKpiCard
          label={`CF Egress · ${winLabel}`}
          value={cfMetrics?.egress.value != null ? fmtMb(cfMetrics.egress.value) : cfMetrics?.unconfigured ? "Setup" : "—"}
          sub={cfMetrics?.unconfigured ? "needs CLOUDFLARE_API_TOKEN" : "edge bandwidth served"}
          accent={HOME_THEME.orange}
          points={sparkPoints(cfMetrics?.egress.spark, cfMs, cfMetrics?.fetchedAt)}
          formatValue={fmtMb}
          invertDelta
          height={64}
          showAxes={false}
        />
        <LiveKpiCard
          label={`Host Net · ${hostLabel}`}
          value={renderMetrics?.bandwidth.value != null ? fmtMb(renderMetrics.bandwidth.value) : renderMetrics?.unconfigured ? "Setup" : "—"}
          sub={renderMetrics?.unconfigured ? "needs HETZNER_API_TOKEN" : "server egress"}
          accent={HOME_THEME.cyan}
          points={sparkPoints(renderMetrics?.bandwidth.spark, hostMs, renderMetrics?.fetchedAt)}
          formatValue={fmtMb}
          invertDelta
          height={64}
          showAxes={false}
        />
        <LiveKpiCard
          label="Memory · App RSS"
          value={renderMetrics?.memory.value != null ? fmtBytes(renderMetrics.memory.value) : "—"}
          sub="resident set size"
          accent={memAccent}
          points={sparkPoints(renderMetrics?.memory.spark, hostMs, renderMetrics?.fetchedAt)}
          formatValue={fmtBytes}
          invertDelta
          height={64}
          showAxes={false}
        />
        <LiveKpiCard
          label={`CPU · ${renderWindow === "live" ? "Latest" : `${hostLabel} Avg`}`}
          value={renderMetrics?.cpu.value != null ? `${(renderMetrics.cpu.value * 100).toFixed(1)}%` : "—"}
          sub="host utilisation"
          accent={cpuAccent}
          points={sparkPoints(renderMetrics?.cpu.spark, hostMs, renderMetrics?.fetchedAt)}
          formatValue={(v) => `${(v * 100).toFixed(1)}%`}
          invertDelta
          height={64}
          showAxes={false}
        />
      </div>
    </div>
  );
}

/** Overview's headline tiles.
 *
 *  Split out of OverviewSection so the `useLiveSeries` hooks below can run at a
 *  stable, unconditional top level. Two of these metrics ship real per-day
 *  history from the API; the other five are point-in-time scalars, so each poll
 *  is appended to an in-memory rolling series — that is what makes the line
 *  "live" rather than a static 7-point sparkline. */
function KpiStrip({
  isMobile, totalVisits, users, subscribers, onToday, activeSessions, waitlist, infra, visits, signups, gran,
}: {
  isMobile: boolean;
  totalVisits: number;
  users: number | null;
  subscribers: number | null;
  onToday: number;
  activeSessions: number | null;
  waitlist: number | null;
  infra: { cpu: { value: string; spark: number[] }; wsPerHr: string };
  visits: PageVisit[];
  signups: Array<{ createdAt: number | null }>;
  gran: OverviewGran;
}) {
  // Scalars with no server-side history — accumulated from each poll.
  const onTodaySeries = useLiveSeries(onToday);
  const sessionsSeries = useLiveSeries(activeSessions);
  const waitlistSeries = useLiveSeries(waitlist);
  const wsPerHrNum = Number.parseFloat(String(infra.wsPerHr).replace(/[^0-9.\-]/g, ""));
  const wsSeries = useLiveSeries(Number.isFinite(wsPerHrNum) ? wsPerHrNum : null);
  // Stripe reports a current count only — no per-day history — so this builds
  // from polls like the other scalars.
  const subsSeries = useLiveSeries(subscribers);

  // Bucketed at the header's granularity, so the strip re-scales with the rest
  // of the page.
  //
  // MEMOISED, and here it matters most: the five useLiveSeries hooks above
  // append a point on every poll, so this component re-renders on a timer. A
  // bare call re-bucketed the whole visit log each time — the same work the
  // metrics section below was already doing, twice per poll.
  const { traffic, signups: signupBuckets } = useMemo(
    () => seriesFor(gran, visits, signups),
    [gran, visits, signups],
  );

  // Visits: per-bucket loads. Running-total them and baseline so the final
  // point lands exactly on the printed total.
  const visitsSeries: LivePoint[] = (() => {
    if (!traffic.counts.length) return [];
    const total = traffic.counts.reduce((a, b) => a + b, 0);
    let run = 0;
    return traffic.counts.map((c, i) => {
      run += c;
      return { label: traffic.labels[i] ?? "", value: totalVisits - (total - run) };
    });
  })();

  // Same trick for users: cumulative signups, baselined onto the live total.
  const usersSeries: LivePoint[] = (() => {
    const base = (users ?? 0) - signupBuckets.counts.reduce((a, b) => a + b, 0);
    let run = base;
    return signupBuckets.counts.map((c, i) => {
      run += c;
      return { label: signupBuckets.labels[i] ?? "", value: run };
    });
  })();
  const cpuSeries: LivePoint[] = infra.cpu.spark.map((v) => ({ value: v }));

  const A = ["#5B9BD5", "#3FB8A0", "#E8A23D", "#4FB3C9", "#88C97A", "#E06C5E", "#E0A85E", "#B58BD8"];
  const int = (v: number) => Math.round(v).toLocaleString();

  const tiles: {
    label: string; value: string; points: LivePoint[]; accent: string;
    fmt?: (v: number) => string; invert?: boolean;
  }[] = [
    { label: "Visits · 12d", value: totalVisits.toLocaleString(), points: visitsSeries, accent: A[0], fmt: int },
    { label: "Total users", value: users != null ? users.toLocaleString() : "—", points: usersSeries, accent: A[1], fmt: int },
    { label: "Subscribers", value: subscribers != null ? subscribers.toLocaleString() : "—", points: subsSeries, accent: A[7], fmt: int },
    { label: "On today", value: onToday.toLocaleString(), points: onTodaySeries, accent: A[2], fmt: int },
    { label: "Logged in · 30d", value: activeSessions != null ? activeSessions.toLocaleString() : "—", points: sessionsSeries, accent: A[3], fmt: int },
    { label: "Waitlist", value: waitlist != null ? waitlist.toLocaleString() : "—", points: waitlistSeries, accent: A[4], fmt: int },
    { label: "CPU", value: infra.cpu.value, points: cpuSeries, accent: A[5], fmt: (v) => `${(v * 100).toFixed(1)}%`, invert: true },
    { label: "WS out/hr", value: infra.wsPerHr, points: wsSeries, accent: A[6], fmt: int },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(4, minmax(0,1fr))", gap: 10 }}>
      {tiles.map((t) => (
        <LiveKpiCard
          key={t.label}
          label={t.label}
          value={t.value}
          accent={t.accent}
          points={t.points}
          formatValue={t.fmt}
          invertDelta={t.invert}
          height={64}
          showAxes={false}
        />
      ))}
    </div>
  );
}

// ─── Top pages ────────────────────────────────────────────────────────────────
//
// WHAT CHANGED AND WHY: this card used to be five bars off `page_load_status`
// lifetime totals. That table keeps ONE row per page key with a running counter,
// so it could answer "which page has been loaded most since the beginning of
// time" and nothing else — no window, no idea who loaded it, no idea how they
// got there. "Which pages are customers actually on this week" was unanswerable.
//
// It now aggregates the raw page_visits log instead (the same rows the map and
// the heatmap read), which carries per-load identity, subscription status and
// entry attribution. That buys three things the counter could not:
//
//   • a real time window (24h / 7d / 30d / all),
//   • unique VISITORS alongside loads — 400 loads from 3 people is a very
//     different fact from 400 loads from 300 people,
//   • the member / non-member split, and with it the answer to "what do people
//     who haven't signed up look at" — the landing page, pricing, sign-up and
//     unsubscribe, which is all a logged-out visitor CAN look at.
//
// WHAT "MEMBER" MEANS HERE — this is the one definition that has to be right.
// A member is someone who REGISTERED: the visit row carries a user_id, which
// /api/page-status fills from the session cookie. It is deliberately NOT
// "is_subscriber", which the first cut of this card used and which was wrong in
// a way that showed: a signed-in free or lapsed account browsing the dashboard
// counted as a NON-member, so the non-members list filled up with /es-candles
// and /traders-dashboard — pages middleware will not serve to a logged-out
// visitor at all. Non-member traffic on a gated page is a contradiction, and
// seeing one means the split is measuring the wrong thing.
//
// Paying is still tracked, as a subset: each row reports how many of its member
// loads came from an active/trialing subscription. Registered-but-not-paying is
// a real and interesting group — it is the trial funnel — and collapsing it into
// either side loses that.
//
// Two more exclusions, both stated in the card rather than applied silently:
// bots (Googlebot and Discord's link unfurler would top the list on a quiet
// day), and the owner's own visits (Brandon reloading a page he is building is
// not a customer visiting it).

type PagesAudience = "all" | "members" | "nonmembers";
type PagesWindowKey = "24h" | "7d" | "30d" | "all";

const PAGES_WINDOWS: { key: PagesWindowKey; label: string; hours: number | null }[] = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 24 * 7 },
  { key: "30d", label: "30d", hours: 24 * 30 },
  { key: "all", label: "All", hours: null },
];

const PAGES_AUDIENCES: { key: PagesAudience; label: string; hint: string }[] = [
  { key: "all", label: "Everyone", hint: "every non-bot visit, owner excluded" },
  { key: "members", label: "Members", hint: "signed in with a registered account" },
  { key: "nonmembers", label: "Non-members", hint: "no account — logged-out visitors only" },
];

/**
 * Public (logged-out) routes are beaconed with page_key `public:<slug>` by
 * components/analytics/MarketingPageTracker. The slug is URL-shaped, so without
 * this map the non-members list reads "public:whats-new" / "public:sign-up".
 * Keep in sync with MARKETING_ROUTES in that file.
 */
const PUBLIC_PAGE_LABELS: Record<string, string> = {
  landing: "Landing",
  pricing: "Pricing",
  docs: "Docs",
  explore: "Explore",
  "whats-new": "What's New",
  "about-me": "About",
  "sign-in": "Sign in",
  "sign-up": "Sign up",
  checkout: "Checkout",
  "coming-soon": "Coming soon",
  terms: "Terms",
  privacy: "Privacy",
  disclaimer: "Disclaimer",
  "risk-disclosure": "Risk disclosure",
  unsubscribe: "Unsubscribe",
};

/** Dashboard page key → its sidebar label, via the NAV_GROUPS table above.
 *
 *  Built ONCE into a lookup map. This is called per visit row from
 *  describePage(); the old body rebuilt a flattened array of every nav item and
 *  linear-scanned it on each call, so a 20k-row pass over the visit log
 *  allocated 20k throwaway arrays before it counted anything. */
const NAV_LABEL_BY_HREF: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const g of NAV_GROUPS) {
    for (const it of g.items) m.set("/" + it.href.replace(/^\//, "").toLowerCase(), it.label);
  }
  return m;
})();

function navLabelFor(key: string): string | null {
  return NAV_LABEL_BY_HREF.get("/" + key.replace(/^\//, "").toLowerCase()) ?? null;
}

/**
 * One visit row → { id, name, route, isPublic }. `id` is the grouping key, so a
 * page that was beaconed under a key AND (on older rows) under a bare path still
 * collapses to one line wherever we can tell they're the same thing.
 */
type PageDesc = { id: string; name: string; route: string; isPublic: boolean };

/** Memo for describePage. The visit log has tens of thousands of rows and only
 *  a few dozen distinct (page_key, path, label) triples, so every row after the
 *  first for a page is a map hit instead of a regex + nav lookup. */
const PAGE_DESC_CACHE = new Map<string, PageDesc>();

function describePage(v: PageVisit): PageDesc {
  const cacheKey = `${v.pageKey ?? ""}\u0000${v.path ?? ""}\u0000${v.pageLabel ?? ""}`;
  const cached = PAGE_DESC_CACHE.get(cacheKey);
  if (cached) return cached;
  const built = describePageUncached(v);
  // Distinct pages are few; the guard only exists so a pathological log can't
  // grow this without bound.
  if (PAGE_DESC_CACHE.size > 4000) PAGE_DESC_CACHE.clear();
  PAGE_DESC_CACHE.set(cacheKey, built);
  return built;
}

function describePageUncached(v: PageVisit): PageDesc {
  const key = (v.pageKey || "").trim();
  const path = (v.path || "").trim();

  if (key.startsWith("public:")) {
    const slug = key.slice("public:".length) || "landing";
    return {
      id: key,
      name: PUBLIC_PAGE_LABELS[slug] ?? slug.replace(/-/g, " "),
      route: path || (slug === "landing" ? "/" : `/${slug}`),
      isPublic: true,
    };
  }
  if (key) {
    const bare = key.replace(/^\//, "");
    return {
      id: `app:${bare.toLowerCase()}`,
      name: navLabelFor(key) ?? v.pageLabel ?? bare,
      route: path || `/${bare}`,
      isPublic: false,
    };
  }
  // Pre-page_key rows, and anything that beaconed a path only.
  const p = path || "(unknown)";
  const slug = p.split("/")[1] ?? "";
  const isPublic = p === "/" || slug in PUBLIC_PAGE_LABELS;
  return {
    id: `path:${p.toLowerCase()}`,
    name: (p === "/" ? "Landing" : PUBLIC_PAGE_LABELS[slug]) ?? navLabelFor(p) ?? p,
    route: p,
    isPublic,
  };
}

/** Unique-person key: the account when signed in, the IP when not. */
function visitorKey(v: PageVisit): string {
  return v.userId ? `u:${v.userId}` : v.ip ? `ip:${v.ip}` : "";
}

const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct",
  search: "Search",
  social: "Social",
  referral: "Referral",
  email: "Email",
  paid: "Paid",
  internal: "Internal",
};

function TopPagesCard({
  visits,
  isMobile,
  cardStyle,
  titleStyle,
  accent,
}: {
  visits: PageVisit[];
  isMobile: boolean;
  cardStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  accent: string;
}) {
  const [audience, setAudience] = useState<PagesAudience>("all");
  const [win, setWin] = useState<PagesWindowKey>("7d");
  const [expanded, setExpanded] = useState(false);

  const view = useMemo(() => {
    const hours = PAGES_WINDOWS.find((w) => w.key === win)?.hours ?? null;
    const cutoff = hours == null ? null : Date.now() - hours * 3600_000;

    type Agg = {
      id: string; name: string; route: string; isPublic: boolean;
      loads: number; memberLoads: number; guestLoads: number; paidLoads: number;
      visitors: Set<string>;
      channels: Map<string, number>;
      lastSeen: number;
    };
    const byPage = new Map<string, Agg>();
    const allVisitors = new Set<string>();
    const allMembers = new Set<string>();
    let totalLoads = 0;
    let memberLoadsTotal = 0;
    let paidLoadsTotal = 0;
    let botLoads = 0;
    let ownerLoads = 0;
    let scanned = 0;

    for (const v of visits) {
      const t = v.createdAt ? Date.parse(v.createdAt) : NaN;
      if (cutoff != null && (!Number.isFinite(t) || t < cutoff)) continue;
      scanned++;
      if (v.isBot) { botLoads++; continue; }
      // Owner traffic is not customer traffic. Counted and reported, not hidden.
      if (v.isOwner) { ownerLoads++; continue; }

      // REGISTERED, not paying — see the block comment above this component.
      // A user_id means an account; no user_id means a logged-out visitor, and
      // a logged-out visitor is the only thing "non-member" can honestly mean,
      // because every gated page is unreachable without a session.
      const isMember = Boolean(v.userId);
      if (audience === "members" && !isMember) continue;
      if (audience === "nonmembers" && isMember) continue;

      const d = describePage(v);
      let a = byPage.get(d.id);
      if (!a) {
        a = {
          ...d, loads: 0, memberLoads: 0, guestLoads: 0, paidLoads: 0,
          visitors: new Set(),
          channels: new Map(), lastSeen: 0,
        };
        byPage.set(d.id, a);
      }
      a.loads++;
      totalLoads++;
      if (isMember) {
        a.memberLoads++;
        memberLoadsTotal++;
        // Paying is a SUBSET of registered, never a third bucket — the gap
        // between the two is the trial/free funnel and is worth seeing.
        if (v.isSubscriber === true) { a.paidLoads++; paidLoadsTotal++; }
      } else {
        a.guestLoads++;
      }
      const who = visitorKey(v);
      if (who) {
        a.visitors.add(who);
        allVisitors.add(who);
        if (isMember) allMembers.add(who);
      }
      // Attribution only exists on entry rows, so this is "how the sessions that
      // STARTED on this page arrived" — not how everyone who ever saw it did.
      if (v.isEntry && v.channel) a.channels.set(v.channel, (a.channels.get(v.channel) ?? 0) + 1);
      if (Number.isFinite(t) && t > a.lastSeen) a.lastSeen = t;
    }

    const rows = [...byPage.values()]
      .sort((x, y) => y.loads - x.loads || y.visitors.size - x.visitors.size)
      .map((a) => {
        const top = [...a.channels.entries()].sort((x, y) => y[1] - x[1])[0];
        return {
          id: a.id, name: a.name, route: a.route, isPublic: a.isPublic,
          loads: a.loads, memberLoads: a.memberLoads, guestLoads: a.guestLoads,
          paidLoads: a.paidLoads,
          visitors: a.visitors.size,
          topChannel: top ? (CHANNEL_LABELS[top[0]] ?? top[0]) : null,
          topChannelN: top ? top[1] : 0,
          lastSeen: a.lastSeen,
        };
      });

    // A gated page reached by someone with no account should be impossible.
    // If it happens the split is lying (or middleware is), so say so loudly
    // rather than letting a wrong number sit in a table looking like a fact.
    const leaks = rows.filter((r) => !r.isPublic && r.guestLoads > 0);

    return {
      rows,
      leaks,
      totalLoads,
      totalVisitors: allVisitors.size,
      memberVisitors: allMembers.size,
      memberLoadsTotal,
      paidLoadsTotal,
      botLoads,
      ownerLoads,
      hasRowsInWindow: scanned > 0,
    };
  }, [visits, audience, win]);

  const shown = expanded ? view.rows.slice(0, 40) : view.rows.slice(0, 10);
  const max = view.rows[0]?.loads ?? 0;
  const num = (n: number) => n.toLocaleString();
  const dim = { color: HOME_THEME.text, opacity: 0.45 } as React.CSSProperties;
  const mono: React.CSSProperties = { fontFamily: "monospace", fontVariantNumeric: "tabular-nums" };

  const Pill = ({ on, label, title, onClick }: { on: boolean; label: string; title?: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "3px 10px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer",
        color: on ? HOME_THEME.cyan : HOME_THEME.text,
        background: on ? `${HOME_THEME.cyan}22` : "rgba(255,255,255,0.04)",
        border: `1px solid ${on ? `${HOME_THEME.cyan}55` : HOME_THEME.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  // Grid: page | loads | visitors | split | source | last. Phones drop the
  // split bar and the source column — six numeric columns at 390px is a smear.
  const cols = isMobile ? "minmax(0,1fr) 52px 52px" : "minmax(0,1fr) 62px 62px 120px 96px 64px";

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ ...titleStyle, marginBottom: 0, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
          Pages being visited
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {PAGES_AUDIENCES.map((a) => (
            <Pill key={a.key} on={a.key === audience} label={a.label} title={a.hint} onClick={() => setAudience(a.key)} />
          ))}
          <span style={{ width: 8 }} />
          {PAGES_WINDOWS.map((w) => (
            <Pill key={w.key} on={w.key === win} label={w.label} onClick={() => setWin(w.key)} />
          ))}
        </div>
      </div>

      {/* Denominators, stated. Loads and visitors are different counts, and
          "member" is registered-not-paying, so both get said out loud rather
          than left for the reader to assume. */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 12, ...dim }}>
        <span><b style={{ color: HOME_THEME.text, opacity: 1, ...mono }}>{num(view.totalLoads)}</b> loads</span>
        <span><b style={{ color: HOME_THEME.text, opacity: 1, ...mono }}>{num(view.totalVisitors)}</b> people</span>
        {audience === "all" && view.memberVisitors > 0 && (
          <span title="How many of those people had an account. The rest were logged out.">
            <b style={{ color: HOME_THEME.text, opacity: 1, ...mono }}>{num(view.memberVisitors)}</b> with accounts
          </span>
        )}
        <span><b style={{ color: HOME_THEME.text, opacity: 1, ...mono }}>{view.rows.length}</b> pages</span>
        {audience !== "nonmembers" && view.memberLoadsTotal > 0 && (
          <span title="Registered accounts. Paying is the subset in parentheses — the gap is your trial / free funnel.">
            <b style={{ color: HOME_THEME.text, opacity: 1, ...mono }}>{num(view.memberLoadsTotal)}</b> member loads
            {" "}({num(view.paidLoadsTotal)} paying)
          </span>
        )}
        {view.botLoads > 0 && <span>{num(view.botLoads)} bot loads excluded</span>}
        {view.ownerLoads > 0 && <span>{num(view.ownerLoads)} owner loads excluded</span>}
      </div>

      {/* Impossible-by-design check. A gated page cannot be served to someone
          without a session, so a non-member load on one means the split (or
          middleware) is wrong — surface it instead of printing it as fact. */}
      {audience !== "members" && view.leaks.length > 0 && (
        <div style={{
          fontSize: 12, lineHeight: 1.55, marginBottom: 12, padding: "8px 10px", borderRadius: 8,
          color: HOME_THEME.text, background: `${HOME_THEME.orange}14`, border: `1px solid ${HOME_THEME.orange}44`,
        }}>
          <b style={{ color: HOME_THEME.orange }}>Check this:</b>{" "}
          {view.leaks.length} gated page{view.leaks.length > 1 ? "s" : ""} logged loads with no account attached
          {" — "}
          <span style={mono}>{view.leaks.slice(0, 3).map((r) => r.route).join(", ")}</span>
          {view.leaks.length > 3 ? ` +${view.leaks.length - 3} more` : ""}.
          {" "}A logged-out visitor can't reach those, so it's usually a beacon firing before the session
          cookie resolves — not real anonymous traffic.
        </div>
      )}

      {view.rows.length === 0 ? (
        <div style={{ fontSize: 14, ...dim, lineHeight: 1.6 }}>
          {!view.hasRowsInWindow
            ? `Nothing logged in the last ${PAGES_WINDOWS.find((w) => w.key === win)?.label}. Try a wider window.`
            : audience === "members"
              ? "No signed-in page loads in this window."
              : audience === "nonmembers"
                ? "No logged-out page loads in this window — every visit came from a registered account."
                : "No page loads recorded yet."}
        </div>
      ) : (
        <>
          {/* Header row */}
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", ...dim, paddingBottom: 6, borderBottom: `1px solid ${HOME_THEME.border}` }}>
            <span>Page</span>
            <span style={{ textAlign: "right" }}>Loads</span>
            <span style={{ textAlign: "right" }}>People</span>
            {!isMobile && <span title="Loads from registered accounts vs logged-out visitors. Paying is the subset shown in parentheses.">Member / guest</span>}
            {!isMobile && <span>Came from</span>}
            {!isMobile && <span style={{ textAlign: "right" }}>Last</span>}
          </div>

          {shown.map((r) => {
            const memberPct = r.loads > 0 ? (r.memberLoads / r.loads) * 100 : 0;
            const paidPct = r.loads > 0 ? (r.paidLoads / r.loads) * 100 : 0;
            return (
              <div
                key={r.id}
                title={`${r.route} — ${num(r.loads)} loads from ${num(r.visitors)} people\n${num(r.memberLoads)} from registered accounts (${num(r.paidLoads)} paying), ${num(r.guestLoads)} logged out`}
                style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${HOME_THEME.border}` }}
              >
                {/* Name + route, with the magnitude bar behind them. */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", flexShrink: 0,
                      padding: "1px 5px", borderRadius: 4,
                      color: r.isPublic ? HOME_THEME.gold : HOME_THEME.cyan,
                      background: r.isPublic ? `${HOME_THEME.gold}1e` : `${HOME_THEME.cyan}1e`,
                    }}>
                      {r.isPublic ? "PUB" : "APP"}
                    </span>
                    <span style={{ fontSize: 14, color: HOME_THEME.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                    <span style={{ fontSize: 12, ...mono, ...dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.route}</span>
                  </div>
                  <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", marginTop: 5 }}>
                    <div style={{ height: "100%", width: `${max > 0 ? Math.max(2, (r.loads / max) * 100) : 0}%`, background: accent, borderRadius: 3 }} />
                  </div>
                </div>

                <span style={{ ...mono, fontSize: 14, textAlign: "right", color: HOME_THEME.text }}>{num(r.loads)}</span>
                <span style={{ ...mono, fontSize: 14, textAlign: "right", color: HOME_THEME.text }}>{num(r.visitors)}</span>

                {/* Registered vs logged-out share of this page's loads, with the
                    paying slice drawn INSIDE the member half rather than as a
                    third segment — paying is a subset of registered, and a
                    three-segment bar would imply three disjoint groups. */}
                {!isMobile && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                      <div style={{ width: `${paidPct}%`, background: HOME_THEME.green }} />
                      <div style={{ width: `${memberPct - paidPct}%`, background: `${HOME_THEME.green}66` }} />
                      <div style={{ width: `${100 - memberPct}%`, background: HOME_THEME.orange }} />
                    </div>
                    <span style={{ fontSize: 11, ...mono, ...dim }}>
                      {num(r.memberLoads)} <span style={{ opacity: 0.7 }}>({num(r.paidLoads)})</span> / {num(r.guestLoads)}
                    </span>
                  </div>
                )}

                {/* Where the sessions that STARTED here arrived from. */}
                {!isMobile && (
                  <span style={{ fontSize: 12, color: r.topChannel ? HOME_THEME.text : undefined, ...(r.topChannel ? {} : dim), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.topChannel ? `${r.topChannel} ×${r.topChannelN}` : "—"}
                  </span>
                )}

                {!isMobile && (
                  <span style={{ fontSize: 12, ...dim, textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.lastSeen ? fmtAgo(new Date(r.lastSeen).toISOString()) : "—"}
                  </span>
                )}
              </div>
            );
          })}

          {view.rows.length > shown.length && (
            <button
              onClick={() => setExpanded(true)}
              style={{ ...homeSecondaryButtonStyle, marginTop: 10, alignSelf: "flex-start", fontSize: 12, padding: "4px 12px" }}
            >
              Show all {view.rows.length} pages
            </button>
          )}
          {expanded && view.rows.length > 40 && (
            <div style={{ fontSize: 11, ...dim, marginTop: 8 }}>Showing the top 40 of {view.rows.length}.</div>
          )}
        </>
      )}
    </div>
  );
}

// React.memo, paired with the useMemo on `metrics` below. Without BOTH, the
// sidebar's 1s clock re-renders every chart, bar list and table on this tab once
// a second — memoising the data alone still hands down a new object, and
// memoising the component alone still gets one. Together, a tick that changes
// nothing on this tab costs nothing on this tab.
const OverviewSection = React.memo(function OverviewSection({ metrics, gran }: {
  gran: OverviewGran;
  metrics: {
    daily: { counts: number[]; labels: string[] };
    dailySignups: { counts: number[]; labels: string[] };
    weekly: { counts: number[]; labels: string[] };
    totalVisits: number;
    activePages: number;
    users: number | null;
    subscribers: number | null;
    waitlist: number | null;
    activeSessions: number | null;
    onToday: number;
    feed: Array<{ label: string; loads: number; ago: string; active: boolean }>;
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
  };
}) {
  const { totalVisits, activePages, users, subscribers, waitlist, activeSessions, onToday, rowsToday, visits, signups, infra } = metrics;
  void activePages;
  const isMobile = useIsMobile();

  // ── Command center — Metabase-style multi-color on dark. ──
  // Categorical palette: each metric/series/row gets its own hue.
  const PALETTE = ["#3FB8A0", "#5DBB8E", "#E8A23D", "#5B9BD5", "#E0A85E", "#E06C5E", "#4FB3C9", "#88C97A"];
  const pc = (i: number) => PALETTE[i % PALETTE.length];
  const TRACK = "rgba(255,255,255,0.06)";
  const cardStyle: React.CSSProperties = { ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 };
  const titleStyle: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11 };

  // Traffic / signups / cumulative all moved into MetricsTabSection, which
  // buckets them at the header's granularity. Top pages owns its own window and
  // scale now (TopPagesCard), so only the rows-written bar list needs a maximum
  // here.
  const rowsMax = rowsToday.length ? Math.max(...rowsToday.map((r) => r.rows), 1) : 1;

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* KPI strip — every tile carries a live line chart, not a sparkline.
          Visits and Total users have real daily history; the rest are scalars
          the API only reports for "now", so `useLiveSeries` accumulates each
          poll into a streaming series (see KpiStrip below). */}
      <KpiStrip
        isMobile={isMobile}
        totalVisits={totalVisits}
        users={users}
        subscribers={subscribers}
        onToday={onToday}
        activeSessions={activeSessions}
        waitlist={waitlist}
        infra={infra}
        visits={visits}
        signups={signups}
        gran={gran}
      />

      {/* Traffic · signups · cumulative with tabs */}
      <MetricsTabSection visits={visits} signups={signups} users={users} activeSessions={activeSessions} period={gran} />

      {/* Pages being visited · rows today.
          Top pages gets ~2/3 of the row: it's a six-column table now, not five
          bars, and squeezing it into half the width re-wraps every route. */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "1.9fr 1fr", gap: 10 }}>
        <TopPagesCard
          visits={visits}
          isMobile={isMobile}
          cardStyle={cardStyle}
          titleStyle={titleStyle}
          accent={pc(3)}
        />
        <div style={cardStyle}>
          <div style={{ ...titleStyle, display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: pc(1) }} />Rows written today · by table</div>
          <BarList rows={rowsToday.map((r) => ({ label: r.label, n: r.rows }))} max={rowsMax} mono />
        </div>
      </div>

      {/* Acquisition — where the traffic came from. Channel / referrer / campaign
          / device, all off the same visit log the card above reads. Sessions
          (entry rows) are its denominator, never pageviews. */}
      <AcquisitionPanel rows={visits} />

      {/* …and the other half of the loop: the short links that FEED the campaign
          table above. It sits directly under that table on purpose — the push
          names it offers as chips are read out of the same log, so reusing a
          name you can see performing is one click. */}
      <CampaignLinkBuilder rows={visits} />

      {/* Visitor choropleth moved to its own /owner/visitors page — the d3
          projection + 177-feature re-render on every hover was dominating this
          tab's frame budget. */}

      {/* The hourly load heatmap was removed on 2026-08-23. Nothing was read
          off it that the Traffic card's live/daily buckets don't already say,
          and it cost a fetch plus a 7×24 fold of the visit log. */}

    </div>
  );
});

// ─── Main ─────────────────────────────────────────────────────────────────────

// Only one tab left since Infra was removed — System/Hosting moved to the top
// of Overview and Controls moved to Admin. The type and nav machinery stay so
// adding a second tab back is a one-line change.
type OwnerTab = "overview";

export default function ControlPanel() {
  const isMobile = useIsMobile();
  const [ownerTab, setOwnerTab] = useState<OwnerTab>("overview");

  // Overview's one time-window control. Lives here so the header can render it
  // and every card under the Overview tab reads the same value.
  const [overviewGran, setOverviewGran] = useState<OverviewGran>("daily");
  useEffect(() => {
    try {
      // A ?tab= URL param wins over the persisted tab (e.g. the admin page's
      // "Owner ↗" link deep-links to /dev/owner?tab=overview).
      const VALID_TABS: string[] = ["overview", "probe", "social-media"];
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
    const VALID_TABS: OwnerTab[] = ["overview"];
    const param = searchParams.get("tab") as OwnerTab | null;
    if (param && VALID_TABS.includes(param)) {
      setOwnerTab(param);
      try { localStorage.setItem("owner-tab", param); } catch { /* ignore */ }
    }
  }, [searchParams]);

  const [server, setServer] = useState<ServerStatus>({});
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
  // Paying subscribers, straight from Stripe. `users` next to it counts every
  // signed-up account — the vast majority of which never pay — so the two
  // side by side are the conversion story.
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/stripe-summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.summary) return;
        setSubscriberCount(Number(j.summary.activeSubscriptions ?? 0));
      })
      .catch(() => { /* Stripe unconfigured or down — the tile just reads — */ });
    return () => { alive = false; };
  }, []);
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
  // Rows still loaded for the EOD GEX panel's own fetch; the Ops queue card that
  // read the array is gone.
  const [eodGex, setEodGex] = useState<EodGexRow[]>([]);
  void eodGex;

  // Auth status (Supabase). Null until first fetch.
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  // Open-feedback count — the card itself lives on Admin now; this is only the
  // number behind the Overview nav badge.
  const [feedbackOpenCount, setFeedbackOpenCount] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/feedback", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setFeedbackOpenCount(Number(j.openCount ?? 0)); })
      .catch(() => { /* badge is cosmetic — a failure just leaves it at 0 */ });
    return () => { alive = false; };
  }, []);

  // Visit log (page loads w/ IP). Collapsed state persisted in localStorage.
  const [visits, setVisits] = useState<PageVisit[]>([]);
  // When the visit log was last pulled. Only advanced on a SUCCESSFUL fetch, so
  // a failed attempt retries on the next refresh instead of waiting 5 minutes.
  const visitsFetchedAtRef = useRef(0);
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
      // Daily Activity + recent-activity agenda + the Top-pages and Acquisition
      // cards, all from real data.
      //
      // days=30 (was: the route's 7-day default) because the Top-pages and
      // Acquisition cards both offer a 30-day window; with only 7 days fetched
      // those buttons silently returned the same 7 days and read as "traffic
      // flat for a month". limit is the response cap, not a storage cap.
      //
      // THROTTLED to once every 5 minutes, unlike everything else in refresh().
      // This is the one payload here measured in thousands of rows, and every
      // arrival replaces the array — which invalidates the memos in four
      // consumers (metrics, Top pages, Acquisition, the link builder) and makes
      // all of them re-derive from scratch. At refresh()'s 60s cadence that was
      // a visible hitch every minute, buying a fresher view of a log that is
      // read in 24h/7d/30d windows. Five minutes is well inside the resolution
      // anything on this tab actually displays.
      const VISITS_MAX_AGE_MS = 5 * 60_000;
      if (Date.now() - visitsFetchedAtRef.current > VISITS_MAX_AGE_MS) {
        try {
          const pv = await fetch("/api/page-visits?days=30&limit=20000", { cache: "no-store" });
          if (pv.ok) {
            const j = await pv.json();
            setVisits((j?.visits ?? []) as PageVisit[]);
            visitsFetchedAtRef.current = Date.now();
          }
        } catch { /* non-fatal */ }
      }

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
  //
  // MEMOISED, and that is load-bearing rather than tidiness. A 1s interval bumps
  // uptimeTick/setTick to keep the sidebar clock moving, which re-renders this
  // component every second. As a bare IIFE this block re-ran on every one of
  // those ticks: a full pass over `visits` for onToday, three more for the daily
  // /weekly series, a sort of pageStatuses — a few thousand rows of work per
  // second, for a clock. It also returned a fresh object each time, so
  // OverviewSection and every chart under it re-rendered at 1Hz as well.
  //
  // Deps are the things the numbers actually come from. displayUptime is NOT
  // among them (see above) — including a per-second value would defeat the memo
  // completely, which is exactly what the removed `uptime` field did.
  const overviewMetrics = useMemo(() => {
    const labelFor = (key: string): string => navLabelFor(key) ?? key;
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

    // Top pages is no longer derived here: page_load_status only holds a
    // lifetime counter per key, which can't be windowed or split by audience.
    // TopPagesCard aggregates the raw page_visits log instead.

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

    // Unique visitors "on today" — distinct user (ip fallback for logged-out)
    // seen since midnight ET. The real "who came today", unlike activeSessions
    // which counts 30-day-unexpired logins regardless of recent activity.
    //
    // Compared on the cheap ET day key rather than a per-row
    // toLocaleDateString — same boundary, without an Intl construction for
    // every one of the ~20k rows in the log. A cutoff alone would not do: the
    // ET day starts at a different UTC instant depending on DST.
    const etToday = etDayKeyMs(Date.now());
    const onTodaySet = new Set<string>();
    for (const v of visits) {
      if (!v.createdAt) continue;
      const t = Date.parse(v.createdAt);
      if (!Number.isFinite(t)) continue;
      if (etDayKeyMs(t) !== etToday) continue;
      const key = v.userId || (v.ip ? `ip:${v.ip}` : "");
      if (key) onTodaySet.add(key);
    }
    const onToday = onTodaySet.size;

    return {
      daily: dailyVisitSeries(visits, 7),
      dailySignups: dailySignupSeries(signups, 7),
      weekly: weeklySignupSeries(signups, 7),
      totalVisits,
      activePages,
      users: authStatus?.stats?.userCount ?? null,
      subscribers: subscriberCount,
      waitlist: waitlistCount,
      activeSessions: authStatus?.stats?.activeSessions ?? null,
      onToday,
      feed,
      rowsToday,
      visits,
      signups,
      infra,

    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageStatuses, visits, authStatus, subscriberCount, waitlistCount, dbStats,
      renderMetrics, cfMetrics, wsBw, cpuPct, memMb]);

  // ── Sidebar nav items ──────────────────────────────────────────────────────
  const NAV_ITEMS: { id: OwnerTab; label: string; badge?: string | number; badgeRed?: boolean }[] = [
    { id: "overview",       label: "Overview" },
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
  //
  // CALLED as a function below — `{SidebarContent()}`, not `<SidebarContent />`.
  // Declaring a component inside render gives it a NEW identity on every render,
  // and React tears down and rebuilds a subtree whose type changed. With the 1s
  // clock tick driving renders, that was the entire mobile drawer unmounting and
  // remounting once a second (losing any focus or scroll inside it). Calling it
  // inlines the JSX into this component's own tree, where it reconciles normally.
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
          {SidebarContent()}
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
            {ownerTab === "overview" && <GranTabs value={overviewGran} onChange={setOverviewGran} />}
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
        {/* Server health + hosting usage — the two rows worth keeping from the
            deleted Infra tab, now leading the Overview page. */}
        {ownerTab === "overview" && (
          <>
            <SystemStrip
              isMobile={isMobile}
              displayUptime={displayUptime}
              lastFeedAgo={lastFeedAgo}
              dxLinkState={server.dxLinkState}
              dxOk={dxOk}
              ttAuthenticated={server.ttAuthenticated}
              ttOk={ttOk}
            />
            <HostingStrip
              isMobile={isMobile}
              renderMetrics={renderMetrics}
              cfMetrics={cfMetrics}
              renderWindow={renderWindow}
              renderLoading={renderLoading}
              onWindow={fetchRenderWindow}
              memAccent={memAccent}
              cpuAccent={cpuAccent}
              gran={overviewGran}
            />
          </>
        )}

        {/* ── Overview dashboard (real front-end data) ── */}
        {ownerTab === "overview" && <OverviewSection metrics={overviewMetrics} gran={overviewGran} />}

        {/* ── Flow / EM ticker visit trackers (overview tab, above feedback) ── */}
        {ownerTab === "overview" && (
          <>
            <TickerVisitsCard source="flow" icon="📡" label="Flow · Ticker Visits" />
            <TickerVisitsCard source="em" icon="🎯" label="EM · Ticker Visits" />
          </>
        )}

        {/* Feedback moved to the Admin page — it's a support queue, not a
            metric, and it belongs next to the other customer panels. The open
            count is still fetched here to badge the Overview nav item. */}

        {/* System KPIs, Hosting metrics and Controls all moved off this file
            when the Infra tab was removed: the handful of system tiles worth
            keeping now render as cards at the top of Overview (see
            SystemStrip / HostingStrip), and Controls + Signal Alerts live on
            the Admin page as <OwnerControls />. */}


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
