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
      { label: "Legacy", href: "/legacy" },
      { label: "Dev", href: "/dev" },
      { label: "Logs", href: "/logs" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
];

const TABLES: { id: string; label: string }[] = [
  { id: "mvc_snapshots", label: "MVC Snaps" },
  { id: "premium_flow", label: "Flow" },
  { id: "es_candles", label: "ES Candles" },
  { id: "trades", label: "Trades" },
  { id: "greeks_ts", label: "Greeks TS" },
  { id: "playbook_feed", label: "Playbook" },
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
    <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.14em" }}>
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
    <div style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.16em", marginBottom: 6 }}>
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
  // Levels auto-publish status (the /em customer feed).
  const [levels, setLevels] = useState<{ count: number; lastRun: string | null; tickers: string[] }>({
    count: 0, lastRun: null, tickers: [],
  });

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
          const all = (await lr.json()) as Array<{ ticker?: string; updated_at?: string }>;
          if (Array.isArray(all) && all.length) {
            const lastRun = all
              .map((r) => r.updated_at)
              .filter(Boolean)
              .sort()
              .pop() ?? null;
            setLevels({
              count: all.length,
              lastRun: lastRun as string | null,
              tickers: all.map((r) => String(r.ticker ?? "")).filter(Boolean),
            });
          } else {
            setLevels({ count: 0, lastRun: null, tickers: [] });
          }
        }
      } catch { /* non-fatal */ }

      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

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
            {TABLES.map(({ id, label }) => {
              const count = (dbStats as Record<string, number>)[id];
              return (
                <div key={id} style={{ ...homePanelStyle, padding: "12px 16px" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: count == null ? "#fff" : count > 0 ? HOME_THEME.cyan : "#fff" }}>
                    {count != null ? fmtNum(count) : "—"}
                  </div>
                  <div style={{ fontSize: 9, color: "#fff" }}>rows today</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Levels auto-publish (/em customer feed) ── */}
        <div>
          <SectionLabel>Levels Publish · /em feed</SectionLabel>
          <div style={{ ...homePanelStyle, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
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
              <a href="/database" style={{ ...homeSecondaryButtonStyle, padding: "6px 14px", borderRadius: 8, textDecoration: "none", fontSize: 11, marginLeft: "auto" }}>
                View table →
              </a>
            </div>
            {levels.tickers.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {levels.tickers.map((t) => (
                  <span key={t} style={{ fontSize: 10, fontWeight: 700, color: HOME_THEME.cyan, background: "rgba(0,229,255,0.08)", border: `1px solid ${HOME_THEME.border}`, padding: "3px 8px", borderRadius: 6, fontFamily: "monospace" }}>{t}</span>
                ))}
              </div>
            )}
          </div>
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
