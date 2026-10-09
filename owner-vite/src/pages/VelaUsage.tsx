import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { OWNER_THEME as T, ownerRgba, homeHeaderStyle, homePanelStyle, homeShellStyle, homeSecondaryButtonStyle } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VELA USAGE — who is on vela.cbedge.net (and /v3/vela), and what they do there.
 *
 * Brandon, 2026-10-07: "need vela tracking on the owner.cbedge.net page — how
 * many on and who, what tickers being used, what indicators being used,
 * anything and everything possible to track".
 *
 * Fed by the Vela page's heartbeat (cbedge-v3/src/pages/vela/telemetry.ts →
 * server-v2/vela-telemetry.cjs). Every open tab reports every 30 s, so:
 *
 *   ON NOW      each open tab: who, where, device, how long, its layout and
 *               every chart on it (symbol · timeframe · indicators), its last
 *               action. Refreshes every 10 s.
 *   THE RANGE   Today / 7d / 30d / 90d / All, one user or everyone, with or
 *               without you: users, sessions, chart time (tab visible) and
 *               engaged time (input in the last 2 min); time per ticker (on
 *               screen and in focus), timeframe, indicator (with adds, removes,
 *               settings changes, errors), layout, device, GEX book; actions;
 *               users per day; the hour-of-week heatmap; every user with their
 *               top tickers and indicators; chart load times; errors; the feed.
 *
 * Time is TAB-VISIBLE time: a backgrounded tab does not count. A ticker's time is
 * the time it was on screen in any chart; "in focus" is the active chart only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── types (the shapes server-v2/vela-telemetry.cjs sends) ──
interface SnapIndicator { name: string; type: string | null; hidden: boolean }
interface SnapCell { id: string; symbol: string | null; tf: string | null; session: string | null; active: boolean; replay: boolean; drawings: number; indicators: SnapIndicator[] }
interface Snapshot { layout: string | null; maximized: string | null; panel: string | null; gex: string | null; phone: boolean; viewport: string | null; cells: SnapCell[] }
interface LiveRow {
  sid: string; userId: string | null; email: string | null; isOwner: boolean;
  host: string | null; path: string | null; device: string | null; browser: string | null; os: string | null;
  place: string | null; tz: string | null; screen: string | null;
  startedAt: string; lastSeenAt: string; visibleSec: number; engagedSec: number; visible: boolean | null;
  snapshot: Snapshot | null;
  lastAction: { name: string; props: Record<string, unknown> | null; ts: string } | null;
}
interface UsageRow { key: string; sec: number; users: number }
interface IndicatorRow extends UsageRow { adds?: number; removes?: number; settings?: number; hides?: number; errors?: number; from_picker?: number }
interface UserRow {
  user_key: string; user_id: string | null; email: string | null; isOwner: boolean;
  sessions: number; visible_sec: number; engaged_sec: number; first_seen: string; last_seen: string;
  devices: string | null; hosts: string | null; places: string | null;
  top: { ticker: { key: string; sec: number }[]; indicator: { key: string; sec: number }[]; timeframe: { key: string; sec: number }[] };
}
interface EventRow { id?: number; ts: string; sid: string; user_id: string | null; email?: string | null; name: string; props: Record<string, unknown> | null }
interface Summary {
  days: number;
  totals: { sessions: number; users: number; visible_sec: number; engaged_sec: number; avg_session_sec: number; longest_session_sec: number };
  usage: Record<string, UsageRow[]>;
  indicators: IndicatorRow[];
  daily: { day: string; users: number; sec: number }[];
  actions: { name: string; n: number; users: number }[];
  loads: { symbol: string | null; tf: string | null; n: number; avg_ms: number; p50_ms: number; p95_ms: number; max_ms: number }[];
  errors: EventRow[];
  users: UserRow[];
  places: { place: string | null; sessions: number; users: number }[];
  browsers: { key: string; sessions: number }[];
  at: string;
}

const RANGES = [
  { key: 1, label: "Today" },
  { key: 7, label: "7d" },
  { key: 30, label: "30d" },
  { key: 90, label: "90d" },
  { key: 0, label: "All" },
] as const;

const LIVE_MS = 10_000;
const SUMMARY_MS = 60_000;
const FEED_MS = 20_000;

// ── formatting ──
function dur(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function ago(ts: string | null | undefined, now: number): string {
  const t = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(t)) return "—";
  return `${dur((now - t) / 1000)} ago`;
}
const tfLabel = (tf: string | null | undefined) => {
  const v = String(tf ?? "");
  if (!v) return "";
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n >= 60 && n % 60 === 0 ? `${n / 60}h` : `${n}m`;
  }
  return v;
};
const who = (email: string | null | undefined, id: string | null | undefined, sid?: string) =>
  email || (id ? `user ${id.slice(0, 10)}` : sid ? `guest ${sid.slice(0, 6)}` : "guest");
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The action names the page sends, as words. */
const ACTION: Record<string, string> = {
  session_start: "Opened Vela",
  symbol: "Changed ticker",
  timeframe: "Changed timeframe",
  indicator_add: "Added an indicator",
  indicator_remove: "Removed an indicator",
  indicator_settings: "Changed indicator settings",
  indicator_hide: "Hid an indicator",
  indicator_show: "Showed an indicator",
  indicator_error: "Indicator error",
  drawing_add: "Drew on a chart",
  drawing_remove: "Removed a drawing",
  layout: "Changed layout",
  maximize: "Maximized a chart",
  restore: "Back to the grid",
  chart_added: "Chart added",
  chart_removed: "Chart removed",
  replay_start: "Started a replay",
  replay_end: "Ended a replay",
  load: "Chart load",
  js_error: "Page error",
  copy_indicators: "Copied indicators to all charts",
  center_today: "Centered today",
  refresh: "Refreshed candles",
  screenshot: "Screenshot",
  picker_open: "Opened Indicators",
  picker_add: "Added from Indicators",
  picker_strategy: "Opened a strategy",
  list_add_all: "Add all (list)",
  lists_saved: "Saved indicator lists",
  gex_basis: "Switched GEX book",
  panel: "Opened a panel",
  theme: "Changed theme",
  tab_visible: "Came back to the tab",
  tab_hidden: "Left the tab",
};

/** One event as a line: "Changed ticker SPY → QQQ". */
function describe(e: { name: string; props: Record<string, unknown> | null }): string {
  const p = e.props ?? {};
  const g = (k: string) => (p[k] == null ? "" : String(p[k]));
  const base = ACTION[e.name] ?? e.name;
  switch (e.name) {
    case "symbol": return `${base} ${g("from")} → ${g("to")}`;
    case "timeframe": return `${base} ${tfLabel(g("from"))} → ${tfLabel(g("to"))}${g("symbol") ? ` on ${g("symbol")}` : ""}`;
    case "indicator_add": case "indicator_remove": case "indicator_settings": case "indicator_hide": case "indicator_show":
      return `${base}: ${g("name")}${g("symbol") ? ` · ${g("symbol")}` : ""}`;
    case "indicator_error": return `${base}: ${g("name")} · ${g("msg")}`;
    case "picker_add": return `${base}: ${g("name")}`;
    case "list_add_all": return `${base}: ${g("list")} (${g("added")} added)`;
    case "layout": return `${base} → ${g("to")}`;
    case "gex_basis": return `${base} → ${g("to")}`;
    case "panel": return `${base}: ${g("name")}`;
    case "load": return `${base}: ${g("symbol")} ${tfLabel(g("tf"))} in ${g("ms")} ms`;
    case "js_error": return `${base}: ${g("msg")}`;
    case "replay_start": return `${base} on ${g("symbol")} ${tfLabel(g("tf"))}`;
    case "drawing_add": return `${base}${g("type") ? ` (${g("type")})` : ""}${g("symbol") ? ` · ${g("symbol")}` : ""}`;
    case "copy_indicators": return `${base} (${g("charts")} charts)`;
    default: return base;
  }
}

async function getJson<J>(url: string): Promise<J> {
  const r = await fetch(url, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as J & { error?: string; detail?: string };
  if (!r.ok) throw new Error(j?.detail || j?.error || `HTTP ${r.status}`);
  return j;
}

// ── small pieces ──
const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const th: CSSProperties = { textAlign: "left", fontWeight: 600, fontSize: 12, color: T.textSecondary, opacity: 0.55, padding: "6px 8px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "5px 8px", borderBottom: `1px solid ${ownerRgba("#FFFFFF", 0.05)}`, fontSize: 13, verticalAlign: "top" };
/** A header cell that stays put while its card scrolls (opaque, so rows pass under it). */
const thStick: CSSProperties = { ...th, position: "sticky", top: 0, zIndex: 1, background: T.panelBgStrong, opacity: 1, color: ownerRgba("#FFFFFF", 0.55) };
/** Every card in the two grids is this tall, so a row of cards lines up; a longer list scrolls inside its card. */
const GRID_CARD_H = 360;

function Card({ title, right, children, span = 1, fill = false }: { title: string; right?: ReactNode; children: ReactNode; span?: 1 | 2 | 3; fill?: boolean }) {
  return (
    <section style={{ ...homePanelStyle, padding: 14, gridColumn: `span ${span}`, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, ...(fill ? { height: "100%", minHeight: 0, overflow: "hidden" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flex: "0 0 auto" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{title}</span>
        {right}
      </div>
      {fill ? <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", margin: "0 -4px", padding: "0 4px" }}>{children}</div> : children}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...homePanelStyle, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: T.textSecondary, opacity: 0.55 }}>{label}</span>
      <span style={{ ...mono, fontSize: 22, fontWeight: 700, color: T.text }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: T.textSecondary, opacity: 0.55 }}>{sub}</span>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: T.textSecondary, opacity: 0.5, padding: "8px 2px" }}>{children}</div>;
}

/** A ranked list with a bar: label · time · users (+ extra columns). */
function Ranked({ rows, max = Infinity, extra, label = (r) => r.key }: {
  rows: UsageRow[] | undefined;
  max?: number;
  extra?: { head: string; cell: (r: UsageRow) => ReactNode }[];
  label?: (r: UsageRow) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const list = rows ?? [];
  if (!list.length) return <Empty>Nothing yet.</Empty>;
  const top = Math.max(1, ...list.map((r) => r.sec));
  const shown = all ? list : list.slice(0, max);
  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStick}></th>
            <th style={{ ...thStick, textAlign: "right" }}>Time</th>
            <th style={{ ...thStick, textAlign: "right" }}>Users</th>
            {extra?.map((x) => <th key={x.head} style={{ ...thStick, textAlign: "right" }}>{x.head}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <td style={{ ...td, width: "45%", minWidth: 110 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{label(r)}</span>
                  <span style={{ height: 2, borderRadius: 2, background: ownerRgba(T.cyan, 0.85), width: `${Math.max(2, (r.sec / top) * 100)}%` }} />
                </div>
              </td>
              <td style={{ ...td, ...mono, textAlign: "right", whiteSpace: "nowrap" }}>{dur(r.sec)}</td>
              <td style={{ ...td, ...mono, textAlign: "right" }}>{r.users}</td>
              {extra?.map((x) => <td key={x.head} style={{ ...td, ...mono, textAlign: "right" }}>{x.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > max && (
        <button type="button" onClick={() => setAll(!all)} style={{ ...homeSecondaryButtonStyle, padding: "4px 10px", fontSize: 12, marginTop: 8 }}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

function ChartChips({ snap }: { snap: Snapshot | null }) {
  if (!snap?.cells?.length) return <span style={{ opacity: 0.5 }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {snap.cells.map((c) => (
        <span
          key={c.id}
          title={c.indicators.map((i) => `${i.name}${i.hidden ? " (hidden)" : ""}`).join(", ") || "no indicators"}
          style={{
            ...mono, fontSize: 12, padding: "1px 6px", borderRadius: 6,
            border: `1px solid ${c.active ? T.borderStrong : T.border}`,
            background: c.active ? ownerRgba("#FFFFFF", 0.06) : "transparent",
            opacity: snap.maximized && snap.maximized !== c.id ? 0.45 : 1,
          }}
        >
          {c.symbol ?? "?"} {tfLabel(c.tf)}{c.replay ? " ⏵" : ""}
          <span style={{ opacity: 0.5 }}> · {c.indicators.length}</span>
        </span>
      ))}
    </div>
  );
}

function SnapshotDetail({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Empty>No snapshot yet.</Empty>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.65 }}>
        Layout {snap.layout ?? "?"} · {snap.cells.length} chart{snap.cells.length === 1 ? "" : "s"}
        {snap.maximized ? " · one maximized" : ""} · GEX {snap.gex ?? "?"} · {snap.phone ? "phone" : "desktop"}
        {snap.viewport ? ` · window ${snap.viewport}` : ""}{snap.panel ? ` · panel: ${snap.panel}` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {snap.cells.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${c.active ? T.borderStrong : T.border}`, borderRadius: 10, padding: "8px 10px", background: T.panelInset }}>
            <div style={{ ...mono, fontWeight: 700, fontSize: 13 }}>
              {c.symbol ?? "?"} <span style={{ opacity: 0.6 }}>{tfLabel(c.tf)} · {c.session === "extended" ? "ETH" : "RTH"}</span>
              {c.active && <span style={{ fontSize: 11, opacity: 0.6 }}> · in focus</span>}
              {c.replay && <span style={{ fontSize: 11, opacity: 0.6 }}> · replay</span>}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
              {c.indicators.length
                ? c.indicators.map((i, k) => (
                  <span key={k} style={{ opacity: i.hidden ? 0.4 : 0.9, textDecoration: i.hidden ? "line-through" : undefined }}>
                    {i.name}{k < c.indicators.length - 1 ? " · " : ""}
                  </span>
                ))
                : <span style={{ opacity: 0.45 }}>no indicators</span>}
            </div>
            {c.drawings > 0 && <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{c.drawings} drawing{c.drawings === 1 ? "" : "s"}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Daily({ rows }: { rows: Summary["daily"] }) {
  if (!rows.length) return <Empty>No days yet.</Empty>;
  const maxU = Math.max(1, ...rows.map((r) => r.users));
  const maxS = Math.max(1, ...rows.map((r) => r.sec));
  // The chart fills its card: each day takes an equal share of the width (28-96px,
  // scrolling sideways past that) and the bars take whatever height is left after
  // the count above them and the date below — so neither label is ever cut off.
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 200, gap: 6 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", alignItems: "stretch", justifyContent: "space-around", gap: 6, overflowX: "auto", overflowY: "hidden" }}>
        {rows.map((r) => (
          <div key={r.day} title={`${r.day}: ${r.users} user${r.users === 1 ? "" : "s"}, ${dur(r.sec)} chart time`} style={{ flex: "1 0 28px", maxWidth: 96, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ ...mono, fontSize: 11, lineHeight: "14px", opacity: 0.8, flex: "0 0 auto" }}>{r.users}</span>
            <div style={{ flex: "1 1 auto", minHeight: 0, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 3 }}>
              <div style={{ width: "34%", maxWidth: 26, height: `${(r.users / maxU) * 100}%`, minHeight: 2, background: ownerRgba(T.cyan, 0.9), borderRadius: 2 }} />
              <div style={{ width: "34%", maxWidth: 26, height: `${(r.sec / maxS) * 100}%`, minHeight: 2, background: ownerRgba("#FFFFFF", 0.35), borderRadius: 2 }} />
            </div>
            <span style={{ ...mono, fontSize: 10, lineHeight: "12px", opacity: 0.55, flex: "0 0 auto", whiteSpace: "nowrap" }}>{r.day.slice(5)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, opacity: 0.55, flex: "0 0 auto" }}>
        <span style={{ color: T.cyan }}>■</span> users · <span style={{ opacity: 0.7 }}>■</span> chart time (hover a day for numbers)
      </div>
    </div>
  );
}

function Heatmap({ rows }: { rows: UsageRow[] | undefined }) {
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.key, r.sec);
    return m;
  }, [rows]);
  const max = Math.max(1, ...grid.values());
  if (!grid.size) return <Empty>No hours yet.</Empty>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 320, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 3 }}>
        <thead>
          <tr>
            <th style={{ width: 34 }} />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} style={{ ...mono, fontSize: 9, fontWeight: 400, opacity: 0.5 }}>{h % 3 === 0 ? h : ""}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DOW.map((d, dow) => (
            <tr key={d}>
              <td style={{ fontSize: 11, opacity: 0.6, paddingRight: 6 }}>{d}</td>
              {Array.from({ length: 24 }, (_, h) => {
                const v = grid.get(`${dow}-${String(h).padStart(2, "0")}`) ?? 0;
                return (
                  <td
                    key={h}
                    title={`${d} ${h}:00 ET · ${dur(v)}`}
                    style={{ height: 26, borderRadius: 3, background: v ? ownerRgba(T.cyan, 0.15 + 0.85 * (v / max)) : ownerRgba("#FFFFFF", 0.04) }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>Chart time by hour of the week, Eastern.</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

export default function VelaUsage() {
  const [days, setDays] = useState<number>(7);
  const [user, setUser] = useState<string>("");
  const [hideOwner, setHideOwner] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [live, setLive] = useState<{ tabs: number; users: number; rows: LiveRow[] } | null>(null);
  const [feed, setFeed] = useState<EventRow[]>([]);
  const [feedName, setFeedName] = useState("");
  const [noLoads, setNoLoads] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isMobile = useIsMobile();
  // a phone has one column: a span there would make a second, off-screen one
  const wide = isMobile ? 1 : 2;

  const qs = useCallback(
    (extra: Record<string, string | number | boolean | undefined> = {}) => {
      const p = new URLSearchParams();
      const all: Record<string, string | number | boolean | undefined> = { days, user: user || undefined, hideOwner: hideOwner ? 1 : undefined, ...extra };
      for (const [k, v] of Object.entries(all)) {
        if (v === undefined || v === "" || v === false) continue;
        p.set(k, v === true ? "1" : String(v));
      }
      return p.toString();
    },
    [days, user, hideOwner],
  );

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getJson<Summary>(`/api/owner/vela/summary?${qs()}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [qs]);
  const loadLive = useCallback(async () => {
    try {
      const j = await getJson<{ tabs: number; users: number; rows: LiveRow[] }>("/api/owner/vela/live");
      setLive(j);
    } catch {
      /* the summary shows the error */
    }
  }, []);
  const loadFeed = useCallback(async () => {
    try {
      const j = await getJson<{ rows: EventRow[] }>(`/api/owner/vela/events?${qs({ days: undefined, limit: 150, name: feedName || undefined, noLoads })}`);
      setFeed(j.rows);
    } catch {
      /* fine */
    }
  }, [qs, feedName, noLoads]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadFeed(); }, [loadFeed]);

  // live every 10 s, the rest on their own clocks, all paused while the tab is hidden
  useEffect(() => {
    void loadLive();
    const timers: number[] = [];
    const start = () => {
      if (timers.length) return;
      timers.push(
        window.setInterval(() => void loadLive(), LIVE_MS),
        window.setInterval(() => void loadSummary(), SUMMARY_MS),
        window.setInterval(() => void loadFeed(), FEED_MS),
        window.setInterval(() => setNow(Date.now()), 5_000),
      );
    };
    const stop = () => { while (timers.length) window.clearInterval(timers.pop()); };
    const onVis = () => {
      if (document.hidden) return stop();
      void loadLive(); void loadSummary(); void loadFeed();
      start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); stop(); };
  }, [loadLive, loadSummary, loadFeed]);

  const s = summary;
  const usage = s?.usage ?? {};
  const userLabel = (key: string) => {
    const u = s?.users.find((x) => x.user_key === key);
    return u ? who(u.email, u.user_id, key.startsWith("sid:") ? key.slice(4) : undefined) : key;
  };
  const indicatorRows: IndicatorRow[] = s?.indicators ?? [];
  const indicatorExtra = [
    { head: "Adds", cell: (r: UsageRow) => (r as IndicatorRow).adds ?? 0 },
    { head: "Removes", cell: (r: UsageRow) => (r as IndicatorRow).removes ?? 0 },
    { head: "Settings", cell: (r: UsageRow) => (r as IndicatorRow).settings ?? 0 },
    { head: "Errors", cell: (r: UsageRow) => (r as IndicatorRow).errors || "" },
  ];
  const engagedPct = s && s.totals.visible_sec ? Math.round((s.totals.engaged_sec / s.totals.visible_sec) * 100) : 0;
  const feedNames = useMemo(() => (s?.actions ?? []).map((a) => a.name), [s]);

  const seg = (on: boolean): CSSProperties => ({
    padding: "6px 10px", fontSize: 13, fontWeight: 600, border: 0, cursor: "pointer",
    background: on ? ownerRgba("#FFFFFF", 0.1) : "transparent", color: T.text,
  });

  return (
    <div style={homeShellStyle}>
      <div style={{ ...homeHeaderStyle, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: T.text }}>Vela Usage</span>
          <span style={{ ...mono, fontSize: 13, padding: "2px 8px", borderRadius: 999, border: `1px solid ${T.border}` }}>
            <span style={{ color: live?.tabs ? "#3ddc8e" : T.textSecondary, opacity: live?.tabs ? 1 : 0.5 }}>●</span>{" "}
            {live ? `${live.users} on now · ${live.tabs} tab${live.tabs === 1 ? "" : "s"}` : "…"}
          </span>
          {s && <span style={{ fontSize: 13, opacity: 0.5 }}>Updated {new Date(s.at).toLocaleTimeString()}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", borderRadius: 10, overflow: "hidden", border: `1px solid ${T.border}` }}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" onClick={() => setDays(r.key)} style={seg(days === r.key)}>{r.label}</button>
            ))}
          </div>
          <select
            value={user}
            onChange={(e) => setUser(e.target.value)}
            style={{ ...homeSecondaryButtonStyle, padding: "6px 10px", fontSize: 13, background: T.panelBgStrong }}
          >
            <option value="">Everyone</option>
            {(s?.users ?? []).map((u) => (
              <option key={u.user_key} value={u.user_key}>{who(u.email, u.user_id, u.user_key.startsWith("sid:") ? u.user_key.slice(4) : undefined)}</option>
            ))}
            {user && !(s?.users ?? []).some((u) => u.user_key === user) && <option value={user}>{user}</option>}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={hideOwner} onChange={(e) => setHideOwner(e.target.checked)} /> Hide me
          </label>
          <button type="button" onClick={() => { void loadLive(); void loadSummary(); void loadFeed(); }} style={{ ...homeSecondaryButtonStyle, padding: "6px 12px", fontSize: 13 }}>
            Refresh
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div style={{ ...homePanelStyle, padding: "10px 14px", fontSize: 13, color: T.red }}>Could not load usage: {error}</div>
        )}

        {/* ── On now ── */}
        <Card title={`On now${live ? ` · ${live.users} user${live.users === 1 ? "" : "s"}` : ""}`} right={<span style={{ fontSize: 12, opacity: 0.5 }}>every 10 s · click a row for every chart</span>}>
          {!live?.rows.length ? (
            <Empty>Nobody has Vela open right now.</Empty>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Who", "Where", "On for", "Charts", "Last action", "Seen"].map((h) => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {live.rows.map((r) => (
                    <FragmentRow key={r.sid} open={open === r.sid} onToggle={() => setOpen(open === r.sid ? null : r.sid)} colSpan={6} detail={<SnapshotDetail snap={r.snapshot} />}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>
                          {who(r.email, r.userId, r.sid)}
                          {r.isOwner && <span style={{ fontSize: 11, opacity: 0.5 }}> · you</span>}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.5 }}>{r.visible === false ? "tab in background" : "looking at it"}</div>
                      </td>
                      <td style={td}>
                        <div>{r.place ?? "—"}</div>
                        <div style={{ fontSize: 12, opacity: 0.5 }}>{[r.host, r.device, r.browser, r.os].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td style={{ ...td, ...mono }}>
                        {dur((now - Date.parse(r.startedAt)) / 1000)}
                        <div style={{ fontSize: 12, opacity: 0.5 }}>{dur(r.visibleSec)} viewed · {dur(r.engagedSec)} active</div>
                      </td>
                      <td style={td}>
                        <ChartChips snap={r.snapshot} />
                        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 3 }}>layout {r.snapshot?.layout ?? "?"} · GEX {r.snapshot?.gex ?? "?"}</div>
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>
                        {r.lastAction ? <>{describe(r.lastAction)}<div style={{ opacity: 0.5 }}>{ago(r.lastAction.ts, now)}</div></> : "—"}
                      </td>
                      <td style={{ ...td, ...mono, fontSize: 12, opacity: 0.7 }}>{ago(r.lastSeenAt, now)}</td>
                    </FragmentRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── headline numbers ── */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <Tile label="Users" value={String(s?.totals.users ?? "…")} sub={user ? userLabel(user) : RANGES.find((r) => r.key === days)?.label} />
          <Tile label="Sessions (tabs)" value={String(s?.totals.sessions ?? "…")} />
          <Tile label="Chart time" value={s ? dur(s.totals.visible_sec) : "…"} sub="tab visible" />
          <Tile label="Active time" value={s ? dur(s.totals.engaged_sec) : "…"} sub={s ? `${engagedPct}% of chart time` : undefined} />
          <Tile label="Avg session" value={s ? dur(s.totals.avg_session_sec) : "…"} sub={s ? `longest ${dur(s.totals.longest_session_sec)}` : undefined} />
          <Tile label="Actions" value={String((s?.actions ?? []).filter((a) => !["load", "tab_visible", "tab_hidden"].includes(a.name)).reduce((t, a) => t + a.n, 0))} />
          <Tile label="Chart loads" value={String((s?.actions ?? []).find((a) => a.name === "load")?.n ?? 0)} />
          <Tile label="Errors" value={String(s?.errors.length ?? 0)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gridAutoRows: GRID_CARD_H, gridAutoFlow: "row dense", gap: 14 }}>
          <Card fill title="Tickers · on screen">
            <Ranked rows={usage.ticker} />
          </Card>
          <Card fill title="Tickers · in focus" right={<span style={{ fontSize: 12, opacity: 0.5 }}>the active chart only</span>}>
            <Ranked rows={usage.ticker_active} />
          </Card>
          <Card fill title="Indicators" span={wide} right={<span style={{ fontSize: 12, opacity: 0.5 }}>time on screen (shown, not hidden) + what people did with them</span>}>
            <Ranked rows={indicatorRows} extra={indicatorExtra} />
          </Card>
          <Card fill title="Timeframes">
            <Ranked rows={usage.timeframe} label={(r) => tfLabel(r.key)} />
          </Card>
          <Card fill title="Layouts">
            <Ranked rows={usage.layout} />
          </Card>
          <Card fill title="Devices · GEX book">
            <Ranked rows={[...(usage.device ?? []), ...(usage.gex ?? []).map((g) => ({ ...g, key: `GEX: ${g.key}` }))]} />
          </Card>
          <Card fill title="Actions">
            {!s?.actions.length ? <Empty>No actions yet.</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={thStick}>What</th><th style={{ ...thStick, textAlign: "right" }}>Times</th><th style={{ ...thStick, textAlign: "right" }}>Users</th></tr></thead>
                <tbody>
                  {s.actions.map((a) => (
                    <tr key={a.name} style={{ cursor: "pointer" }} onClick={() => setFeedName(feedName === a.name ? "" : a.name)} title="Show these in the feed">
                      <td style={{ ...td, fontWeight: feedName === a.name ? 700 : 400 }}>{ACTION[a.name] ?? a.name}</td>
                      <td style={{ ...td, ...mono, textAlign: "right" }}>{a.n}</td>
                      <td style={{ ...td, ...mono, textAlign: "right" }}>{a.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* ── by day and by hour, side by side ── */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", gridAutoRows: GRID_CARD_H, gap: 14 }}>
          <Card fill title="Users per day">
            <Daily rows={s?.daily ?? []} />
          </Card>
          <Card fill title="When">
            <Heatmap rows={usage.hour} />
          </Card>
        </div>

        {/* ── every user ── */}
        <Card title={`Users${s ? ` · ${s.users.length}` : ""}`} right={<span style={{ fontSize: 12, opacity: 0.5 }}>click a name to see only them</span>}>
          {!s?.users.length ? <Empty>Nobody yet.</Empty> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Who", "Sessions", "Chart time", "Active", "Top tickers", "Top indicators", "Timeframes", "Device · where", "First seen", "Last seen"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {s.users.map((u) => (
                    <tr key={u.user_key}>
                      <td style={td}>
                        <button type="button" onClick={() => setUser(user === u.user_key ? "" : u.user_key)} style={{ background: "none", border: 0, padding: 0, color: T.text, fontWeight: 600, cursor: "pointer", textAlign: "left", textDecoration: user === u.user_key ? "underline" : undefined }}>
                          {who(u.email, u.user_id, u.user_key.startsWith("sid:") ? u.user_key.slice(4) : undefined)}
                        </button>
                        {u.isOwner && <span style={{ fontSize: 11, opacity: 0.5 }}> · you</span>}
                      </td>
                      <td style={{ ...td, ...mono }}>{u.sessions}</td>
                      <td style={{ ...td, ...mono }}>{dur(u.visible_sec)}</td>
                      <td style={{ ...td, ...mono }}>{dur(u.engaged_sec)}</td>
                      <td style={{ ...td, fontSize: 12 }}>{u.top.ticker.map((t) => `${t.key} ${dur(t.sec)}`).join(" · ") || "—"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{u.top.indicator.map((t) => t.key).join(" · ") || "—"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{u.top.timeframe.map((t) => tfLabel(t.key)).join(" · ") || "—"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{[u.devices, u.places].filter(Boolean).join(" · ") || "—"}</td>
                      <td style={{ ...td, ...mono, fontSize: 12 }}>{new Date(u.first_seen).toLocaleDateString()}</td>
                      <td style={{ ...td, ...mono, fontSize: 12 }}>{ago(u.last_seen, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gridAutoRows: GRID_CARD_H, gap: 14 }}>
          <Card fill title="Chart load times" right={<span style={{ fontSize: 12, opacity: 0.5 }}>open → first paint</span>}>
            {!s?.loads.length ? <Empty>No loads yet.</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Chart", "Loads", "Avg", "Median", "95%", "Worst"].map((h) => <th key={h} style={{ ...thStick, textAlign: h === "Chart" ? "left" : "right" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {s.loads.map((l) => (
                    <tr key={`${l.symbol}|${l.tf}`}>
                      <td style={{ ...td, ...mono }}>{l.symbol} {tfLabel(l.tf)}</td>
                      {[l.n, l.avg_ms, l.p50_ms, l.p95_ms, l.max_ms].map((v, i) => (
                        <td key={i} style={{ ...td, ...mono, textAlign: "right", color: i > 0 && v > 3000 ? T.red : undefined }}>{i === 0 ? v : `${(v / 1000).toFixed(2)}s`}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card fill title="Where · browsers">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={thStick}>Place</th><th style={{ ...thStick, textAlign: "right" }}>Sessions</th><th style={{ ...thStick, textAlign: "right" }}>Users</th></tr></thead>
                <tbody>
                  {(s?.places ?? []).map((p) => (
                    <tr key={p.place ?? "?"}><td style={td}>{p.place ?? "unknown"}</td><td style={{ ...td, ...mono, textAlign: "right" }}>{p.sessions}</td><td style={{ ...td, ...mono, textAlign: "right" }}>{p.users}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{(s?.browsers ?? []).map((b) => `${b.key} (${b.sessions})`).join(" · ")}</div>
            </div>
          </Card>
          <Card fill title={`Errors${s ? ` · ${s.errors.length}` : ""}`}>
            {!s?.errors.length ? <Empty>No errors in this range.</Empty> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {s.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, borderBottom: `1px solid ${ownerRgba("#FFFFFF", 0.05)}`, paddingBottom: 6 }}>
                    <div style={{ color: T.red }}>{describe(e)}</div>
                    <div style={{ opacity: 0.5 }}>{who(e.email, e.user_id, e.sid)} · {ago(e.ts, now)}{e.props?.src ? ` · ${String(e.props.src)}${e.props.line ? `:${String(e.props.line)}` : ""}` : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── the feed ── */}
        <Card
          title="Activity"
          right={
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select value={feedName} onChange={(e) => setFeedName(e.target.value)} style={{ ...homeSecondaryButtonStyle, padding: "4px 8px", fontSize: 12, background: T.panelBgStrong }}>
                <option value="">Everything</option>
                {feedNames.map((n) => <option key={n} value={n}>{ACTION[n] ?? n}</option>)}
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                <input type="checkbox" checked={noLoads} onChange={(e) => setNoLoads(e.target.checked)} /> Hide chart loads
              </label>
            </div>
          }
        >
          {!feed.length ? <Empty>Nothing yet.</Empty> : (
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {feed.map((e) => (
                    <tr key={e.id ?? `${e.ts}${e.name}`}>
                      <td style={{ ...td, ...mono, fontSize: 12, whiteSpace: "nowrap", opacity: 0.6 }}>{new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                      <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                        <button type="button" onClick={() => setUser(e.user_id ?? `sid:${e.sid}`)} style={{ background: "none", border: 0, padding: 0, color: T.text, cursor: "pointer" }}>
                          {who(e.email, e.user_id, e.sid)}
                        </button>
                      </td>
                      <td style={{ ...td, fontSize: 13 }}>{describe(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div style={{ fontSize: 12, opacity: 0.45, lineHeight: 1.6 }}>
          Every open Vela tab reports every 30 seconds and when it closes. Chart time counts only while the tab is visible;
          active time is the part with a click, key, scroll or mouse move in the last two minutes. A ticker's on-screen time
          counts every chart it was on; in focus counts the active chart. Indicator time counts only while shown (not hidden).
          Days and the heatmap are Eastern time. Tracking started with this release, so there is no history before it.
        </div>
      </div>
    </div>
  );
}

/** A table row that opens a detail row under it. */
function FragmentRow({ children, open, onToggle, detail, colSpan }: { children: ReactNode; open: boolean; onToggle: () => void; detail: ReactNode; colSpan: number }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: open ? ownerRgba("#FFFFFF", 0.03) : undefined }}>{children}</tr>
      {open && (
        <tr>
          <td colSpan={colSpan} style={{ ...td, background: ownerRgba("#FFFFFF", 0.03) }}>{detail}</td>
        </tr>
      )}
    </>
  );
}
