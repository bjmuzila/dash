import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveKpiCard, useLiveSeries, type LivePoint } from "../components/LiveKpiCard";
import { OWNER_THEME as HOME_THEME, homePanelStyle } from "../lib/theme";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SYSTEM HEALTH — the machine, in one block.
 *
 * Everything here used to be the top of Owner → Overview (pages/ControlPanel,
 * deleted 2026-09-15): the server tiles, the Hetzner + Cloudflare hosting
 * strip, the status dots that lived in that page's mobile drawer, and the
 * "rows written today" table count. None of it is about a customer, so when
 * the customer information was consolidated onto pages/Customers.tsx this is
 * what was left — and it belongs on Admin, next to Controls and System Checks.
 *
 * Self-contained: owns its /ws/gex status tap and its 60s poll, so Admin drops
 * it in with `<SystemHealth />` and nothing else.
 *
 * Sources
 *   /ws/gex snapshot frames   → uptime, dxLink, TT auth, contracts, spot
 *   /proxy/idle               → idle mode (Server dot)
 *   /api/db/health            → Postgres probe
 *   /api/db?countOnly         → rows written today per tracked table
 *   /api/hetzner-metrics      → host net + CPU
 *   /api/cloudflare-metrics   → edge egress
 *   /proxy/self-metrics       → app RSS + /ws/gex outbound bytes
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

const ET_TZ = "America/New_York";

type HostWindow = "live" | "weekly" | "monthly";

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

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUptime(s: number): string {
  if (!s || !isFinite(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
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
  isMobile, renderMetrics, cfMetrics, renderWindow, renderLoading, onWindow, memAccent, cpuAccent,
}: {
  isMobile: boolean;
  renderMetrics: RenderMetrics | null;
  cfMetrics: CfMetrics | null;
  renderWindow: HostWindow;
  renderLoading: boolean;
  onWindow: (w: HostWindow) => void;
  memAccent: string;
  cpuAccent: string;
}) {
  const hostMs = renderWindow === "live" ? 3_600_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000;
  const cfMs = renderWindow === "live" ? 86_400_000 : renderWindow === "weekly" ? 604_800_000 : 2_592_000_000;
  const winLabel = renderWindow === "live" ? "24h" : renderWindow === "weekly" ? "7d" : "30d";
  const hostLabel = renderWindow === "live" ? "1h" : renderWindow === "weekly" ? "7d" : "30d";

  const fmtMb = (v: number) => v < 1024 ? `${v.toFixed(1)} MB` : v < 1024 * 1024 ? `${(v / 1024).toFixed(2)} GB` : `${(v / 1024 / 1024).toFixed(2)} TB`;
  const fmtBytes = (v: number) => v < 1024 * 1024 ? `${(v / 1024).toFixed(0)} KB` : `${(v / 1024 / 1024).toFixed(0)} MB`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 1 }}>
          Hosting · Hetzner + Cloudflare
        </span>
        {/* The upstream APIs only expose these three windows (there is no
            yearly), so the strip keeps its own switch rather than borrowing a
            page-level one. */}
        <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: 3 }}>
          {(["live", "weekly", "monthly"] as const).map((w) => (
            <button
              key={w}
              onClick={() => onWindow(w)}
              disabled={renderLoading}
              style={{
                padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                background: renderWindow === w ? HOME_THEME.cyan : "transparent",
                color: renderWindow === w ? "#04141a" : HOME_THEME.text,
              }}
            >
              {w === "live" ? "Live" : w === "weekly" ? "7d" : "30d"}
            </button>
          ))}
        </div>
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

/** The seven status dots from the old Overview drawer, as a compact row. */
function StatusDots({ rows }: { rows: { label: string; ok: boolean; sub?: string }[] }) {
  return (
    <div style={{ ...homePanelStyle, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: "8px 22px", alignItems: "center" }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: row.ok ? HOME_THEME.green : HOME_THEME.red,
            boxShadow: row.ok ? `0 0 5px ${HOME_THEME.green}88` : `0 0 5px ${HOME_THEME.red}88`,
          }} />
          <span style={{ fontSize: 14, color: HOME_THEME.text }}>{row.label}</span>
          {row.sub && <span style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.7, fontFamily: "var(--font-mono)" }}>{row.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** "Rows written today · by table" — the one DB card worth keeping. */
function RowsTodayCard({ rows }: { rows: { label: string; n: number }[] }) {
  const PALETTE = ["#3FB8A0", "#5DBB8E", "#E8A23D", "#5B9BD5", "#E0A85E", "#E06C5E", "#4FB3C9", "#88C97A"];
  const max = rows.length ? Math.max(...rows.map((r) => r.n), 1) : 1;
  return (
    <div style={{ ...homePanelStyle, padding: "13px 15px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.cyan, marginBottom: 11, display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[1] }} />Rows written today · by table
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", columnGap: 24 }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ marginBottom: 9 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 3, color: HOME_THEME.text, fontFamily: "monospace" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />{r.label}
              </span>
              <span>{r.n.toLocaleString()}</span>
            </div>
            <div style={{ height: 7, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((r.n / max) * 100)}%`, background: PALETTE[i % PALETTE.length], borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SystemHealth() {
  const isMobile = useIsMobile();

  const [server, setServer] = useState<ServerStatus>({});
  const uptimeBaseRef = useRef<{ uptime: number; at: number } | null>(null);
  const [dbStats, setDbStats] = useState<DbStats>({});
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; latencyMs: number } | null>(null);
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics | null>(null);
  const [renderWindow, setRenderWindow] = useState<HostWindow>("live");
  const [renderLoading, setRenderLoading] = useState(false);
  const [cfMetrics, setCfMetrics] = useState<CfMetrics | null>(null);
  const [wsBw, setWsBw] = useState<WsBandwidth | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // 1s tick so uptime and feed-age count forward between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Which host window the user picked — the 60s poll re-fetches THAT window
  // rather than yanking the cards back to live.
  const windowRef = useRef<HostWindow>("live");
  windowRef.current = renderWindow;

  const refresh = useCallback(async () => {
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ })).toISOString().slice(0, 10);
    const w = windowRef.current;

    const [idleRes, ...tableResults] = await Promise.allSettled([
      fetch("/proxy/idle"),
      ...TABLES.map(({ id }) =>
        fetch(`/api/db?table=${id}&limit=1&date=${today}&countOnly=true`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ]);

    if (idleRes.status === "fulfilled" && idleRes.value.ok) {
      try {
        const j = await idleRes.value.json();
        setServer((prev) => ({ ...prev, idleMode: typeof j.idle === "boolean" ? j.idle : prev.idleMode }));
      } catch { /* non-fatal */ }
    }

    const counts: DbStats = {};
    tableResults.forEach((res, i) => {
      if (res.status === "fulfilled" && res.value) counts[TABLES[i].id] = res.value.count ?? 0;
    });
    setDbStats(counts);

    try {
      const hr = await fetch("/api/db/health", { cache: "no-store" });
      const hj = await hr.json().catch(() => null);
      setDbHealth({ ok: !!hj?.ok && hr.ok, latencyMs: Number(hj?.latencyMs ?? 0) });
    } catch {
      setDbHealth({ ok: false, latencyMs: 0 });
    }

    // Hetzner + Cloudflare — merge-don't-blank (see the helpers above).
    try {
      const rm = await fetch(`/api/hetzner-metrics?window=${w}`, { cache: "no-store" });
      if (rm.ok) {
        const next = (await rm.json()) as RenderMetrics;
        setRenderMetrics((prev) => mergeRenderMetrics(prev, next));
      }
    } catch { /* non-fatal */ }
    try {
      const cf = await fetch(`/api/cloudflare-metrics?window=${w}`, { cache: "no-store" });
      if (cf.ok) {
        const next = (await cf.json()) as CfMetrics;
        setCfMetrics((prev) => mergeCfMetrics(prev, next));
      }
    } catch { /* non-fatal */ }
    try {
      const sm = await fetch("/proxy/self-metrics", { cache: "no-store" });
      if (sm.ok) { const j = await sm.json(); setWsBw((j?.wsBandwidth ?? null) as WsBandwidth | null); }
    } catch { /* non-fatal */ }

    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const fetchRenderWindow = useCallback(async (w: HostWindow) => {
    setRenderWindow(w);
    windowRef.current = w;
    setRenderLoading(true);
    try {
      const [rm, cf] = await Promise.all([
        fetch(`/api/hetzner-metrics?window=${w}`, { cache: "no-store" }),
        fetch(`/api/cloudflare-metrics?window=${w}`, { cache: "no-store" }),
      ]);
      if (rm.ok) { const next = (await rm.json()) as RenderMetrics; setRenderMetrics((prev) => mergeRenderMetrics(prev, next)); }
      if (cf.ok) { const next = (await cf.json()) as CfMetrics; setCfMetrics((prev) => mergeCfMetrics(prev, next)); }
    } catch { /* non-fatal */ } finally {
      setRenderLoading(false);
    }
  }, []);

  // ── /ws/gex status tap — snapshot frames carry the server status block ──────
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    const schedule = () => {
      if (unmountedRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 3000);
    };
    const connect = () => {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let ws: WebSocket;
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (e) => {
        try {
          const j = JSON.parse(String(e.data));
          if (j?.type !== "snapshot") return;
          const snap = j?.data ?? j;
          const s = snap?.status ?? snap?.data?.status;
          if (!s) return;
          if (typeof s.uptime === "number") uptimeBaseRef.current = { uptime: s.uptime, at: Date.now() };
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
            wsClients: typeof s.wsClients === "number" ? s.wsClients : prev.wsClients,
          }));
        } catch { /* non-JSON fine */ }
      };
      ws.onerror = () => { try { ws.close(); } catch { /* */ } };
      ws.onclose = () => { setWsConnected(false); schedule(); };
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

  // ── Derived ─────────────────────────────────────────────────────────────────
  const isServerUp = !server.idleMode;
  const dxOk = server.dxLinkState === "CONNECTED";
  const ttOk = server.ttAuthenticated === true;
  const displayUptime = uptimeBaseRef.current
    ? uptimeBaseRef.current.uptime + Math.floor((Date.now() - uptimeBaseRef.current.at) / 1000)
    : undefined;
  const lastFeedAgo = server.lastFeedAt ? Math.round((Date.now() - server.lastFeedAt) / 1000) : null;

  const memMb = (renderMetrics?.memory.value ?? 0) / 1024 / 1024;
  const memAccent = memMb > 400 ? HOME_THEME.red : memMb > 200 ? HOME_THEME.orange : HOME_THEME.green;
  const cpuPct = (renderMetrics?.cpu.value ?? 0) * 100;
  const cpuAccent = cpuPct > 80 ? HOME_THEME.red : cpuPct > 40 ? HOME_THEME.orange : HOME_THEME.green;

  const wsTotal = wsBw ? wsBw.lastMinTotal : 0;
  const wsPerHr = wsTotal ? (wsTotal * 60) / 1024 / 1024 : 0; // bytes/min → MB/hr
  const wsSplit = wsBw && wsBw.lastMinTotal
    ? Object.entries(wsBw.lastMin).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${k} ${Math.round((v / wsBw.lastMinTotal) * 100)}%`).join(" · ")
    : "—";

  const statusRows = [
    { label: "Server",   ok: isServerUp, sub: isServerUp ? (displayUptime != null ? fmtUptime(displayUptime) : undefined) : "idle" },
    { label: "Postgres", ok: !!dbHealth?.ok, sub: dbHealth?.ok ? `${dbHealth.latencyMs}ms` : "down" },
    { label: "Theta",    ok: isServerUp && server.spot != null, sub: server.spot != null ? `spot ${server.spot.toFixed(0)}` : "no data" },
    { label: "Greeks",   ok: isServerUp && (server.contractsSubscribed ?? 0) > 0, sub: server.contractsSubscribed != null ? `${server.contractsSubscribed.toLocaleString()} contracts` : "—" },
    { label: "Feed",     ok: isServerUp && lastFeedAgo != null && lastFeedAgo < 10, sub: lastFeedAgo != null ? `${lastFeedAgo}s ago` : "—" },
    { label: "WS proxy", ok: wsConnected, sub: wsConnected ? `${server.wsClients ?? 0} clients` : "offline" },
    { label: "dxLink",   ok: dxOk, sub: server.dxLinkState ?? "—" },
    { label: "WS out",   ok: true, sub: wsPerHr ? `${wsPerHr.toFixed(1)} MB/hr · ${wsSplit}` : "—" },
  ];

  const rowsToday = useMemo(
    () => TABLES.map((t) => ({ label: t.label, n: dbStats[t.id] ?? 0 })),
    [dbStats],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: HOME_THEME.text }}>
          System
        </span>
        {lastRefresh && (
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: HOME_THEME.text, opacity: 0.7 }}>
            polled {lastRefresh.toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
      </div>
      <StatusDots rows={statusRows} />
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
      />
      <RowsTodayCard rows={rowsToday} />
    </div>
  );
}

export default SystemHealth;
