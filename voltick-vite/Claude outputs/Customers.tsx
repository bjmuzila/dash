import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { LiveKpiCard, useLiveSeries, type LivePoint } from "../components/LiveKpiCard";
import AcquisitionPanel from "../components/AcquisitionPanel";
import { VisitorMap } from "../components/VisitorMap";
import { SignupsPanel } from "../components/SignupsPanel";
import {
  CustomerActivityPanel,
  NotPayingPanel,
  DiscordConnectionsPanel,
  FarCbTickersPanel,
  UnsubscribePanel,
  FeedbackPanel,
} from "../components/customerPanels";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  OWNER_THEME as HOME_THEME,
  ownerRgba,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CUSTOMERS — every piece of customer information and tracking, on one page.
 *
 * Until 2026-09-15 this was spread over four routes: the Overview page had the
 * traffic charts, top pages, acquisition and ticker visits; Visitors had the
 * world map; Admin had the per-person lists (activity, Discord, unsubscribes,
 * feedback, not-paying); Sales had the "signed up · never bought" funnel. Same
 * question — "who is using this, and what are they doing?" — answered in four
 * places with four different windows. This page is the one place.
 *
 * Layout, top to bottom, is "numbers → traffic → who":
 *
 *   KPI strip            visits · users · subscribers · on today · logged in · waitlist
 *   Traffic / signups    bucketed at the header granularity
 *   Top pages            what people are actually on
 *   World map            where they are (the old Visitors page, whole)
 *   Acquisition          how they arrived (channel / referrer / campaign / device)
 *   Ticker visits        Flow + EM
 *   Signed up · never bought   the trial funnel, by name
 *   Signed up · not paying     the plain email list for the broadcast page
 *   Customer activity    last login, ~time on site, pages
 *   Discord · Far CB · Unsubscribes · Feedback
 *
 * Data: ONE /api/page-visits fetch feeds the KPI strip, the charts, top pages,
 * the map and acquisition. Its window is the RANGE picker in the header
 * (Today / 7d / 30d / 90d / All), which is server-side — a wider range costs a
 * query, not a bigger client-side filter. The GRANULARITY picker next to it
 * only changes how the charts bucket what's loaded. The per-person panels
 * below are self-fetching (their own endpoints, their own loading states).
 *
 * The old Overview page's system tiles (uptime, feed, hosting, rows written)
 * went to Admin as components/SystemHealth.tsx — none of that is a customer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageStatus {
  pageKey: string;
  pageLabel: string;
  lastSeen?: string;
  status?: string;
  totalLoads?: number;
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

/** Server-side window for the visit log, in days. `all` = no date floor. */
const RANGES = [
  { key: "1", label: "Today" },
  { key: "7", label: "7d" },
  { key: "30", label: "30d" },
  { key: "90", label: "90d" },
  { key: "all", label: "All" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/** Fetch / render budget. The map draws a dot per visitor, so this is about
 *  frame time, not storage — the API reports `truncated` when the window held
 *  more. */
const RENDER_LIMIT = 20000;

/** Data older than this with no new rows means the beacon is probably broken,
 *  not that traffic stopped. Loud enough to notice, slack enough for a quiet
 *  overnight hour. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "12s / 4m / 2h / 3d ago" for the beacon-age readout in the header. */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Short "12s / 4m / 2h / 3d ago" relative stamp for the top-pages table. */
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
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>Loading…</div>
        ) : ranked.length === 0 ? (
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1 }}>No ticker visits recorded in this window.</div>
        ) : ranked.map((r, i) => (
          <div key={r.ticker} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 1, width: 18, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.text, width: 70, flexShrink: 0 }}>{r.ticker}</span>
            <div style={{ flex: 1, height: 9, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((r.clicks / max) * 100)}%`, background: HOME_THEME.cyan, borderRadius: 5 }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: HOME_THEME.cyan, width: 54, textAlign: "right", flexShrink: 0 }}>{r.clicks.toLocaleString()}</span>
            <span title="impressions" style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 1, width: 60, textAlign: "right", flexShrink: 0 }}>{r.renders.toLocaleString()} imp</span>
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
        <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 1, fontFamily: "var(--font-mono)" }}>
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
              <div key={i} style={{ flex: 1, fontSize: 12, color: HOME_THEME.text, opacity: 1, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
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
              <div key={i} style={{ flex: 1, fontSize: 12, color: HOME_THEME.text, opacity: 1, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
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
              <div key={i} style={{ flex: 1, fontSize: 12, color: HOME_THEME.text, opacity: 1, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
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

/** The headline tiles.
 *
 *  Its own component so the `useLiveSeries` hooks below can run at a stable,
 *  unconditional top level. Two of these metrics ship real per-day history
 *  from the API; the rest are point-in-time scalars, so each poll is appended
 *  to an in-memory rolling series — that is what makes the line "live" rather
 *  than a static sparkline. CPU and WS-out went to Admin (SystemHealth). */
function KpiStrip({
  isMobile, totalVisits, users, subscribers, onToday, activeSessions, waitlist, visits, signups, gran,
}: {
  isMobile: boolean;
  totalVisits: number;
  users: number | null;
  subscribers: number | null;
  onToday: number;
  activeSessions: number | null;
  waitlist: number | null;
  visits: PageVisit[];
  signups: Array<{ createdAt: number | null }>;
  gran: OverviewGran;
}) {
  // Scalars with no server-side history — accumulated from each poll.
  const onTodaySeries = useLiveSeries(onToday);
  const sessionsSeries = useLiveSeries(activeSessions);
  const waitlistSeries = useLiveSeries(waitlist);
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

  const A = ["#5B9BD5", "#3FB8A0", "#E8A23D", "#4FB3C9", "#88C97A", "#E06C5E", "#E0A85E", "#B58BD8"];
  const int = (v: number) => Math.round(v).toLocaleString();

  const tiles: {
    label: string; value: string; points: LivePoint[]; accent: string;
    fmt?: (v: number) => string; invert?: boolean;
  }[] = [
    { label: "Visits · lifetime", value: totalVisits.toLocaleString(), points: visitsSeries, accent: A[0], fmt: int },
    { label: "Total users", value: users != null ? users.toLocaleString() : "—", points: usersSeries, accent: A[1], fmt: int },
    { label: "Subscribers", value: subscribers != null ? subscribers.toLocaleString() : "—", points: subsSeries, accent: A[7], fmt: int },
    { label: "On today", value: onToday.toLocaleString(), points: onTodaySeries, accent: A[2], fmt: int },
    { label: "Logged in · 30d", value: activeSessions != null ? activeSessions.toLocaleString() : "—", points: sessionsSeries, accent: A[3], fmt: int },
    { label: "Waitlist", value: waitlist != null ? waitlist.toLocaleString() : "—", points: waitlistSeries, accent: A[4], fmt: int },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(3, minmax(0,1fr))", gap: 10 }}>
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
 * The public slug for a visit, or null if the row is a real app page.
 *
 * WHY THIS EXISTS: two different beacons fire on every marketing page.
 * MarketingPageTracker sends `public:pricing`; LayoutShell's VisitTracker sends
 * the bare trimmed path — `pricing`, and `home` for "/". describePage() used to
 * treat "has a key, no public: prefix" as "app page", so the SECOND beacon for
 * "/", "/pricing", "/sign-in" and every other marketing route landed as a GATED
 * page with no account attached — which is impossible by construction, so the
 * leak check lit up with ~20 false positives that were really just the other
 * beacon for a page anyone is allowed to see.
 *
 * The path is the authority here, not the key: "/" is the landing page even
 * though its bare key is "home", which is also the key of the gated /home
 * dashboard route. Falling back to the key only covers rows that beaconed no
 * path at all.
 */
function publicSlugFor(path: string, key: string): string | null {
  const p = path.trim();
  if (p) {
    if (p === "/") return "landing";
    const slug = p.split("/")[1] ?? "";
    return slug in PUBLIC_PAGE_LABELS ? slug : null;
  }
  const k = key.replace(/^\//, "").split("/")[0] ?? "";
  if (!k || k === "home") return null; // ambiguous without a path — leave it alone
  return k in PUBLIC_PAGE_LABELS ? k : null;
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
    // A bare key that names a public route is the LayoutShell beacon for a
    // marketing page. Fold it onto the same id the prefixed beacon uses so the
    // page reads as one public line instead of a phantom gated one.
    const pub = publicSlugFor(path, key);
    if (pub) {
      return {
        id: `public:${pub}`,
        name: PUBLIC_PAGE_LABELS[pub] ?? pub.replace(/-/g, " "),
        route: path || (pub === "landing" ? "/" : `/${pub}`),
        isPublic: true,
      };
    }
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
  const dim = { color: HOME_THEME.text, opacity: 1 } as React.CSSProperties;
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
          <span title="Registered accounts. Paying is the subset in parentheses — the gap is signed-up accounts that have not bought.">
            <b style={{ color: HOME_THEME.text, opacity: 1, ...mono }}>{num(view.memberLoadsTotal)}</b> member loads
            {" "}({num(view.paidLoadsTotal)} paying)
          </span>
        )}
        {view.botLoads > 0 && <span>{num(view.botLoads)} bot loads excluded</span>}
        {view.ownerLoads > 0 && <span>{num(view.ownerLoads)} owner loads excluded</span>}
      </div>

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
                      {num(r.memberLoads)} <span style={{ opacity: 1 }}>({num(r.paidLoads)})</span> / {num(r.guestLoads)}
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

      {/* Impossible-by-design check. A gated page cannot be served to someone
          without a session, so a non-member load on one means the split (or
          middleware) is wrong — surface it instead of printing it as fact. */}
      {audience !== "members" && view.leaks.length > 0 && (
        <div style={{
          fontSize: 12, lineHeight: 1.55, marginTop: 14, padding: "8px 10px", borderRadius: 8,
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
    </div>
  );
}

// React.memo, paired with the useMemo on `metrics` in the page. Without BOTH,
// every poll re-renders every chart, table and the map — memoising the data
// alone still hands down a new object, and memoising the component alone still
// gets one. Together, a tick that changes nothing costs nothing.
const CustomersOverview = React.memo(function CustomersOverview({ metrics, gran }: {
  gran: OverviewGran;
  metrics: {
    totalVisits: number;
    users: number | null;
    subscribers: number | null;
    waitlist: number | null;
    activeSessions: number | null;
    onToday: number;
    visits: PageVisit[];
    signups: Array<{ createdAt: number | null }>;
  };
}) {
  const { totalVisits, users, subscribers, waitlist, activeSessions, onToday, visits, signups } = metrics;
  const isMobile = useIsMobile();

  // Categorical palette: each metric/series/row gets its own hue.
  const PALETTE = ["#3FB8A0", "#5DBB8E", "#E8A23D", "#5B9BD5", "#E0A85E", "#E06C5E", "#4FB3C9", "#88C97A"];
  const pc = (i: number) => PALETTE[i % PALETTE.length];
  const cardStyle: React.CSSProperties = { ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 };
  const titleStyle: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11 };

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
        visits={visits}
        signups={signups}
        gran={gran}
      />

      {/* Traffic · signups · cumulative with tabs */}
      <MetricsTabSection visits={visits} signups={signups} users={users} activeSessions={activeSessions} period={gran} />

      {/* Pages being visited — full width: it's a six-column table. The
          "rows written today" card that used to share this row is on Admin. */}
      <TopPagesCard
        visits={visits}
        isMobile={isMobile}
        cardStyle={cardStyle}
        titleStyle={titleStyle}
        accent={pc(3)}
      />

      {/* Where they are. The old /owner/visitors page, whole — inside this
          React.memo section so the KPI strip's live-series ticks never
          re-render the d3 projection; only a new visit array does. */}
      <VisitorMap rows={visits} />

      {/* Acquisition — where the traffic came from. Channel / referrer / campaign
          / device, all off the same visit log the cards above read. Sessions
          (entry rows) are its denominator, never pageviews. The Campaign Link
          Builder that fed this table lives on Sales now, under Revenue by
          source — that's the page where you find out whether a link paid. */}
      <AcquisitionPanel rows={visits} />

    </div>
  );
});

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Customers() {
  const isMobile = useIsMobile();

  // One time-window control for the charts. Lives here so the header can
  // render it and every card reads the same value.
  const [gran, setGran] = useState<OverviewGran>("daily");

  // Server-side window for the visit log. Opens on All — the point of keeping
  // the whole history (page_visits is no longer trimmed) is to see it; the
  // 20k cap and the truncation notice keep a large All range honest.
  const [range, setRange] = useState<RangeKey>("all");

  const [pageStatuses, setPageStatuses] = useState<PageStatus[]>([]);
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  // Paying subscribers, straight from Stripe. `users` next to it counts every
  // signed-up account — the vast majority of which never pay — so the two
  // side by side are the conversion story.
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // The visit log (page loads w/ IP + geo + account), and what the API said
  // about the window it came from.
  const [visits, setVisits] = useState<PageVisit[]>([]);
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [visitsError, setVisitsError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ total: number; truncated: boolean; newestAt: string | null; oldestAt: string | null } | null>(null);

  // Ticks once a minute so "last visit N ago" counts up between fetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/stripe-summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.summary) setSubscriberCount(Number(j.summary.activeSubscriptions ?? 0)); })
      .catch(() => { /* Stripe unconfigured or down — the tile just reads — */ });
    return () => { alive = false; };
  }, []);

  // ── Visit log ─────────────────────────────────────────────────────────────
  // Fetched on its own cadence, separately from the cheap scalars below: this
  // is the one payload measured in thousands of rows, and every arrival
  // replaces the array, which invalidates the memos in every consumer. A
  // range change or ↻ fetches immediately; otherwise hourly, and on tab
  // re-focus (a tab left open all day would otherwise show a morning
  // snapshot and read as "nobody new").
  const rangeRef = useRef<RangeKey>(range);
  rangeRef.current = range;
  const loadVisits = useCallback(async (rangeKey: RangeKey, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setVisitsLoading(true);
    setVisitsError(null);
    try {
      const res = await fetch(`/api/page-visits?days=${rangeKey}&limit=${RENDER_LIMIT}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      const rows = (j?.visits ?? []) as PageVisit[];
      setVisits(rows);
      setMeta({
        total: Number(j?.total ?? rows.length),
        truncated: Boolean(j?.truncated),
        newestAt: j?.newestAt ?? null,
        oldestAt: j?.oldestAt ?? null,
      });
      setNow(Date.now());
    } catch (e) {
      setVisitsError(e instanceof Error ? e.message : "Failed to load visits");
    } finally {
      setVisitsLoading(false);
    }
  }, []);

  useEffect(() => { void loadVisits(range); }, [loadVisits, range]);

  useEffect(() => {
    let timer: number | undefined;
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(() => { void loadVisits(rangeRef.current, { quiet: true }); }, 60 * 60 * 1000);
    };
    const stop = () => { if (timer == null) return; window.clearInterval(timer); timer = undefined; };
    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      void loadVisits(rangeRef.current, { quiet: true });
      start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); stop(); };
  }, [loadVisits]);

  // ── Cheap scalars — every 60s ─────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const pageRes = await fetch("/api/db?table=page_load_status&limit=50");
        if (pageRes.ok) {
          const j = await pageRes.json();
          const rows: Record<string, unknown>[] = j?.rows ?? (Array.isArray(j) ? j : []);
          setPageStatuses(rows.map((r) => ({
            pageKey: String(r.page_key ?? r.pageKey ?? ""),
            pageLabel: String(r.page_label ?? r.pageLabel ?? r.page_key ?? ""),
            lastSeen: String(r.last_loaded_at ?? r.lastLoadedAt ?? r.updated_at ?? ""),
            status: r.is_loaded ? "active" : "inactive",
            totalLoads: Number(r.total_loads ?? r.totalLoads ?? 0),
          })));
        }
      } catch { /* non-fatal */ }

      try {
        const wl = await fetch("/api/waitlist/count", { cache: "no-store" });
        if (wl.ok) { const j = await wl.json(); setWaitlistCount(j?.count ?? 0); }
      } catch { /* non-fatal */ }

      // Auth status (masked — never includes any secret value).
      try {
        const ck = await fetch("/api/auth-status", { cache: "no-store" });
        if (ck.ok) setAuthStatus((await ck.json()) as AuthStatus);
      } catch { /* non-fatal */ }

      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  //
  // MEMOISED, and that is load-bearing: the KPI strip's live series append a
  // point on every poll, so the page re-renders on a timer. A bare block here
  // would re-walk ~20k rows for onToday each time and hand CustomersOverview a
  // fresh object, re-rendering every chart and the map under it.
  const metrics = useMemo(() => {
    const totalVisits = pageStatuses.reduce((sum, p) => sum + (p.totalLoads ?? 0), 0);
    const signups = (authStatus?.stats?.recent ?? []).map((u) => ({ createdAt: u.createdAt }));

    // Unique visitors "on today" — distinct user (ip fallback for logged-out)
    // seen since midnight ET. Compared on the cheap ET day key: the ET day
    // starts at a different UTC instant depending on DST, so a cutoff won't do.
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

    return {
      totalVisits,
      users: authStatus?.stats?.userCount ?? null,
      subscribers: subscriberCount,
      waitlist: waitlistCount,
      activeSessions: authStatus?.stats?.activeSessions ?? null,
      onToday: onTodaySet.size,
      visits,
      signups,
    };
  }, [pageStatuses, visits, authStatus, subscriberCount, waitlistCount]);

  // Beacon health. "Nobody visited" and "we stopped recording visits" look the
  // same on a chart — say which one this is.
  const newestMs = meta?.newestAt ? Date.parse(meta.newestAt) : NaN;
  const newestAge = Number.isFinite(newestMs) ? now - newestMs : null;
  const beaconStale = newestAge != null && newestAge > STALE_AFTER_MS;
  const geoCoded = useMemo(
    () => visits.reduce((n, v) => n + (typeof v.lat === "number" && typeof v.lon === "number" ? 1 : 0), 0),
    [visits],
  );

  const busy = loading || visitsLoading;

  return (
    <div style={{ ...homeShellStyle, height: "100%", maxHeight: "100%" }}>
      <style>{`
        .owner-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .owner-scroll::-webkit-scrollbar-track { background: transparent; }
        .owner-scroll::-webkit-scrollbar-thumb { background: ${HOME_THEME.cyan}40; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
        .owner-scroll::-webkit-scrollbar-thumb:hover { background: ${HOME_THEME.cyan}80; background-clip: padding-box; }
        .owner-scroll { scrollbar-width: thin; scrollbar-color: ${HOME_THEME.cyan}40 transparent; }
        /* THE COLLAPSED-CARD BUG: the scroll body is a column flex container
           with height:0, and cards with overflow:hidden were free to shrink to
           two 2px lines. Nothing in the scroll body should ever shrink — it
           scrolls. */
        .owner-page-body > * { flex-shrink: 0; }
      `}</style>

      {/* Header */}
      <div style={{ ...homeHeaderStyle, padding: isMobile ? "10px 12px" : "10px 18px", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "0.01em", color: HOME_THEME.text, whiteSpace: "nowrap" }}>
            Customers
          </span>
          {lastRefresh && !isMobile && (
            <span style={{ fontSize: 14, color: HOME_THEME.text, fontFamily: "var(--font-mono)" }}>
              {lastRefresh.toLocaleTimeString("en-US", { hour12: false })}
            </span>
          )}
          {newestAge != null && (
            <span
              style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: beaconStale ? HOME_THEME.red : HOME_THEME.green, opacity: beaconStale ? 1 : 0.85, whiteSpace: "nowrap" }}
              title={beaconStale
                ? "No visit has been logged recently — check that the /api/page-status beacon is still reaching the server."
                : "Age of the most recent logged page load."}
            >
              {beaconStale ? "⚠ " : "● "}last visit {agoLabel(newestAge)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Range — server-side window for the visit log (map, charts, top
              pages, acquisition). */}
          <div style={{ display: "inline-flex", borderRadius: 10, overflow: "hidden", border: `1px solid ${HOME_THEME.border}` }}>
            {RANGES.map((r) => {
              const active = r.key === range;
              return (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  disabled={visitsLoading && active}
                  style={{
                    padding: "5px 11px", fontSize: 14, fontWeight: active ? 700 : 400, cursor: "pointer", border: "none",
                    fontFamily: "inherit",
                    background: active ? ownerRgba(HOME_THEME.cyan, 0.22) : "transparent",
                    color: active ? HOME_THEME.text : HOME_THEME.textSecondary,
                    opacity: active ? 1 : 0.6,
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          {/* Granularity — how the charts bucket what's loaded. */}
          <GranTabs value={gran} onChange={setGran} />
          <button
            onClick={() => { void refresh(); void loadVisits(range); }}
            disabled={busy}
            style={{ ...homeSecondaryButtonStyle, padding: "5px 14px", fontSize: 14, opacity: busy ? 0.5 : 1 }}
          >
            {busy ? "…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div
        className="owner-scroll owner-page-body"
        style={{
          flex: 1, minHeight: 0, height: 0, overflowY: "auto", overflowX: "hidden",
          padding: isMobile ? "12px" : "clamp(14px,2vw,24px)",
          display: "flex", flexDirection: "column", gap: 12,
          WebkitOverflowScrolling: "touch",
        } as React.CSSProperties}
      >
        {visitsError && (
          <div style={{ ...homePanelStyle, padding: "14px 18px", color: HOME_THEME.red, fontSize: 14 }}>{visitsError}</div>
        )}
        {beaconStale && !visitsError && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: HOME_THEME.textSecondary, lineHeight: 1.6, borderColor: ownerRgba(HOME_THEME.red, 0.4) }}>
            <b style={{ color: HOME_THEME.red }}>No page load has been logged in {agoLabel(newestAge!)}.</b>{" "}
            Either traffic really has stopped, or the <code>/api/page-status</code> beacon is no longer
            reaching the server — check that the route is still public and that the SPA is loading
            <code> LayoutShell</code>.
          </div>
        )}

        {/* Numbers → traffic → pages → map → acquisition */}
        <CustomersOverview metrics={metrics} gran={gran} />

        {/* Cloudflare only attaches geo headers once the managed transform is
            on, so rows logged before that have no country and no coords. */}
        {visits.length > 0 && geoCoded === 0 && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: HOME_THEME.textSecondary, lineHeight: 1.6 }}>
            None of the {visits.length.toLocaleString()} logged loads carry geo data yet. Enable Cloudflare's
            <b style={{ color: HOME_THEME.cyan }}> Add visitor location headers </b> managed transform — rows logged
            after that will start plotting.
          </div>
        )}
        {meta?.truncated && (
          <div style={{ ...homePanelStyle, padding: "12px 16px", fontSize: 14, color: HOME_THEME.textSecondary, lineHeight: 1.6 }}>
            Showing the newest <b style={{ color: HOME_THEME.gold }}>{visits.length.toLocaleString()}</b> of{" "}
            <b style={{ color: HOME_THEME.gold }}>{meta.total.toLocaleString()}</b> loads in this range — the log is
            capped at {RENDER_LIMIT.toLocaleString()} rows per fetch. Narrow the range for a complete picture of a shorter window.
            {meta.oldestAt && <> History goes back to {new Date(meta.oldestAt).toLocaleDateString()}.</>}
          </div>
        )}

        {/* Product usage — which tickers get opened where. */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(2, minmax(0,1fr))", gap: 12 }}>
          <TickerVisitsCard source="flow" icon="📡" label="Flow · Ticker Visits" />
          <TickerVisitsCard source="em" icon="🎯" label="EM · Ticker Visits" />
        </div>

        {/* ── The people, by name ─────────────────────────────────────────── */}

        {/* The trial funnel: everyone who made an account and did not buy,
            with how far they got. From the Sales page. */}
        <SignupsPanel />

        {/* The same group as a flat email list, for the broadcast page.
            Sourced from Supabase auth, independent of Stripe config. */}
        <NotPayingPanel />

        {/* Customer engagement — last login, ~time on site, pages visited. */}
        <CustomerActivityPanel />

        {/* Who's linked their Discord account. */}
        <DiscordConnectionsPanel />

        {/* Far CB Watch — which customers added which tickers to the roster. */}
        <FarCbTickersPanel />

        {/* Global email suppression list — who unsubscribed + manual edits. */}
        <UnsubscribePanel />

        {/* Support queue. Also has its own page under Content (/owner/feedback)
            for answering; this copy is here so "what are customers saying"
            sits next to "what are customers doing". */}
        <FeedbackPanel />
      </div>
    </div>
  );
}
