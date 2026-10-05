import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  OWNER_THEME as T,
  TYPE,
  ownerRgba,
  statTileStyle,
  homeSecondaryButtonStyle,
} from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { useRefreshButton } from "../hooks/useRefreshButton";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AI CONNECTIONS — who has CB Edge plugged into Gemini, ChatGPT or Claude.
 *
 * Members connect at https://www.cbedge.net/mcp and sign in with their normal
 * CB Edge login (server-v2/mcp-oauth.js). This page is the owner's view of it,
 * fed by GET /api/admin/mcp-connections (server-v2/mcp-admin.js, owner-only):
 *
 *   • Connections — one row per approval ("grant"): member, app, live /
 *     revoked / expired, last used, tool calls. Disconnect revokes it; the
 *     app's next refresh fails and it asks the member to reconnect.
 *     "Pending" / "Unclaimed" rows were approved on the consent page but the
 *     app never traded the code for tokens — the signature of an app that
 *     "connected" and then does nothing.
 *   • Tool calls per day and by tool.
 *   • Activity — every step of a connection (the app reaching /mcp and reading
 *     the metadata, registering, the member being sent to sign in, the Allow
 *     page), approvals, revocations, and every refusal with what the app
 *     actually sent (redirect URLs, grant type, error). When an AI app says
 *     "the server rejected it" — or a connection never shows up at all — the
 *     answer is in this list. No discovery row for an app means its requests
 *     never reached the server.
 *   • Tools — every tool the connector offers, including ones never called.
 *   • Registered apps — each automatic app registration (DCR) in the window.
 *
 * Counts and logs follow the range picker. The connection list is every grant
 * still on file (spent tokens are pruned 7 days after they expire).
 * ─────────────────────────────────────────────────────────────────────────────
 */

type AppKind = "gemini" | "chatgpt" | "claude" | "local" | "other";
type Status = "live" | "revoked" | "expired" | "pending" | "unclaimed";

interface Connection {
  familyId: string;
  userId: string;
  email: string | null;
  app: AppKind;
  appName: string | null;
  clientId: string;
  status: Status;
  connectedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  calls: number;
  errors: number;
  lastTool: string | null;
}

interface EventRow {
  id: number;
  at: string;
  kind: string;
  clientId: string | null;
  clientName: string | null;
  app: AppKind | null;
  email: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

interface Report {
  generatedAt: string;
  days: number;
  chartDays: number;
  connectorOn: boolean;
  maxGrants: number;
  totals: {
    live: number; members: number; activeMembers: number; calls: number; errors: number; calls24h: number;
    registrations: number; registrationsUsed: number; refused: number; unclaimed: number;
    probes?: number; probeCallers?: number;
  };
  connections: Connection[];
  apps: { app: AppKind; live: number; calls: number }[];
  daily: { day: string; calls: number; errors: number; members: number }[];
  tools: { tool: string; calls: number; errors: number; avgMs: number | null; members: number; offered?: boolean }[];
  clients: {
    clientId: string; name: string | null; app: AppKind; authMethod: string; createdAt: string | null;
    firstUsedAt: string | null; callbacks: number; hosts: string[]; connections: number;
  }[];
  events: EventRow[];
}

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

const POLL_MS = 60_000;

const APP: Record<AppKind, { label: string; color: string }> = {
  gemini: { label: "Gemini", color: T.cyan },
  chatgpt: { label: "ChatGPT", color: T.gold },
  claude: { label: "Claude", color: T.orange },
  local: { label: "Local test", color: T.green },
  other: { label: "Other", color: T.green },
};

const STATUS: Record<Status, { label: string; icon: string; color: string; hint: string }> = {
  live: { label: "Live", icon: "●", color: T.green, hint: "Connected and refreshable." },
  revoked: { label: "Revoked", icon: "✕", color: T.red, hint: "Cut off — see the reason underneath." },
  expired: { label: "Expired", icon: "○", color: T.text, hint: "Not used for 30 days; the member has to reconnect." },
  pending: { label: "Pending", icon: "◷", color: T.gold, hint: "Approved in the last 5 minutes; waiting for the app to collect its tokens." },
  unclaimed: { label: "Unclaimed", icon: "⚠", color: T.orange, hint: "Approved, but the app never collected its tokens. The connection never started." },
};

const EVENT: Record<string, { label: string; icon: string; color: string; problem: boolean }> = {
  probe: { label: "Reached the connector", icon: "→", color: T.cyan, problem: false },
  registered: { label: "App registered", icon: "+", color: T.cyan, problem: false },
  signin_required: { label: "Sent to sign in", icon: "↪", color: T.gold, problem: false },
  consent_shown: { label: "Shown Allow page", icon: "◻", color: T.text, problem: false },
  approved: { label: "Approved", icon: "✓", color: T.green, problem: false },
  revoked: { label: "Revoked", icon: "✕", color: T.red, problem: false },
  consent_denied: { label: "Denied by member", icon: "⊘", color: T.text, problem: false },
  no_membership: { label: "No membership", icon: "$", color: T.gold, problem: true },
  register_refused: { label: "Registration refused", icon: "⚠", color: T.orange, problem: true },
  authorize_refused: { label: "Sign-in link refused", icon: "⚠", color: T.orange, problem: true },
  token_refused: { label: "Token refused", icon: "⚠", color: T.orange, problem: true },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function ago(isoStr: string | null | undefined, now: number): string {
  if (!isoStr) return "—";
  const t = Date.parse(isoStr);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 45 ? `${days}d ago` : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stamp(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const fmt = (n: number) => n.toLocaleString("en-US");

const PROBE_STEP: Record<string, string> = {
  mcp_unauthorized: "Hit /mcp without a token (got the sign-in challenge)",
  resource_metadata: "Read the resource metadata",
  auth_metadata: "Read the sign-in server metadata",
};
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** One line that says what an activity row means, from its detail payload. */
function eventSummary(e: EventRow): string {
  const d = e.detail || {};
  switch (e.kind) {
    case "probe":
      return [PROBE_STEP[str(d.step)] || str(d.step), str(d.ua) && `UA ${str(d.ua)}`].filter(Boolean).join(" · ");
    case "registered": {
      const uris = Array.isArray(d.redirect_uris) ? (d.redirect_uris as unknown[]).map(str) : [];
      const hosts = [...new Set(uris.map((u) => { try { return new URL(u).host; } catch { return ""; } }).filter(Boolean))];
      return [str(d.client_name) && `client "${str(d.client_name)}"`, `${uris.length} callback${uris.length === 1 ? "" : "s"}`,
        hosts.join(", "), str(d.token_endpoint_auth_method)].filter(Boolean).join(" · ");
    }
    case "signin_required":
      return "Not signed in to CB Edge — sent to the sign-in page";
    case "consent_shown":
      return "Signed in, shown the Allow / Cancel page";
    case "revoked":
      return str(d.reason) || "revoked";
    case "register_refused": {
      const uris = Array.isArray(d.redirect_uris) ? (d.redirect_uris as unknown[]).map(str) : [];
      const name = str(d.client_name);
      return `${str(d.message) || str(d.error)}${name ? ` · client "${name}"` : ""}${uris.length > 1 ? ` · ${uris.length} callback URLs sent` : ""}`;
    }
    case "authorize_refused":
      return [str(d.why), str(d.description), str(d.redirect_uri), str(d.client_id) && `client_id ${str(d.client_id)}`, str(d.host) && `via ${str(d.host)}`]
        .filter(Boolean).join(" · ");
    case "token_refused":
      return [str(d.grant_type) && `grant ${str(d.grant_type)}`, str(d.error), str(d.description),
        d.basic_auth === true ? "sent Basic auth" : "", str(d.client_id) && `client_id ${str(d.client_id)}`]
        .filter(Boolean).join(" · ");
    case "no_membership":
      return "Signed in without an active membership — shown the Membership required page";
    case "consent_denied":
      return "Clicked Cancel on the consent page";
    case "approved":
      return "Clicked Allow on the consent page";
    default:
      return "";
  }
}

// ── small pieces ─────────────────────────────────────────────────────────────

const cellStyle: CSSProperties = {
  padding: "9px 10px",
  borderBottom: `1px solid ${T.border}`,
  fontSize: TYPE.body,
  color: T.text,
  verticalAlign: "top",
  whiteSpace: "nowrap",
};
const headStyle: CSSProperties = {
  ...cellStyle,
  fontSize: TYPE.label,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: T.green,
  background: T.panelInset,
  position: "sticky",
  top: 0,
};
const subText: CSSProperties = { fontSize: TYPE.label, color: T.green, whiteSpace: "normal" };
const mono: CSSProperties = { fontFamily: "var(--font-mono)" };

function AppTag({ app, name }: { app: AppKind | null; name?: string | null }) {
  const a = APP[app || "other"];
  const showName = name && name.toLowerCase() !== a.label.toLowerCase();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: a.color, flexShrink: 0 }} />
      <span style={{ fontWeight: 700 }}>{a.label}</span>
      {showName && <span style={subText}>“{name}”</span>}
    </span>
  );
}

function Pill({ color, icon, label, title }: { color: string; icon: string; label: string; title?: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999,
        fontSize: TYPE.label, fontWeight: 700, color,
        background: ownerRgba(color, 0.12), border: `1px solid ${ownerRgba(color, 0.32)}`, whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>{icon}</span>{label}
    </span>
  );
}

function Segmented<V extends string | number>({ value, options, onChange }: {
  value: V; options: readonly { value: V; label: string }[]; onChange: (v: V) => void;
}) {
  return (
    <div style={{ display: "inline-flex", borderRadius: 10, overflow: "hidden", border: `1px solid ${T.border}` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            style={{
              padding: "5px 12px", fontSize: TYPE.body, fontWeight: active ? 700 : 500, cursor: "pointer", border: "none",
              background: active ? ownerRgba(T.cyan, 0.22) : "transparent", color: active ? T.text : T.green,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: string }) {
  return (
    <div style={{ ...statTileStyle, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${T.border}` }}>
      <span style={{ fontSize: TYPE.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>{label}</span>
      <span style={{ ...mono, fontSize: TYPE.display, fontWeight: 800, color: tone ?? T.text, lineHeight: 1.1 }}>{value}</span>
      {sub != null && <span style={{ fontSize: TYPE.label, color: T.green }}>{sub}</span>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "18px 4px", fontSize: TYPE.body, color: T.green }}>{children}</div>;
}

// ── tool calls per day ───────────────────────────────────────────────────────
// One series (calls), one hue, bars anchored to the baseline with 4px rounded
// tops and a 2px gap. Errors and members ride in the hover readout.

function DailyBars({ rows }: { rows: Report["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 140;
  const W = 640;
  const PAD_TOP = 18;
  const n = Math.max(1, rows.length);
  const max = Math.max(1, ...rows.map((r) => r.calls));
  const slot = W / n;
  const gap = 2;
  const bw = Math.max(2, slot - gap);
  const y = (v: number) => H - (v / max) * (H - PAD_TOP);
  const r = Math.min(4, bw / 2);
  const barPath = (x: number, top: number) => {
    const h = H - top;
    if (h <= 0) return "";
    const rr = Math.min(r, h);
    return `M${x},${H} L${x},${top + rr} Q${x},${top} ${x + rr},${top} L${x + bw - rr},${top} Q${x + bw},${top} ${x + bw},${top + rr} L${x + bw},${H} Z`;
  };
  const label = (day: string) => {
    const [, m, d] = day.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  const h = hover != null ? rows[hover] : null;
  const total = rows.reduce((s, r2) => s + r2.calls, 0);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, minHeight: 22 }}>
        <span style={{ fontSize: TYPE.label, color: T.green }}>
          {h ? (
            <>
              <b style={{ color: T.text }}>{label(h.day)}</b> · {fmt(h.calls)} calls · {fmt(h.errors)} errors · {fmt(h.members)} member{h.members === 1 ? "" : "s"}
            </>
          ) : (
            <>{fmt(total)} calls over {rows.length} days · hover a bar</>
          )}
        </span>
        <span style={{ ...mono, fontSize: TYPE.label, color: T.green }}>max {fmt(max)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        width="100%"
        style={{ display: "block", overflow: "visible" }}
        role="img"
        aria-label="Tool calls per day"
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={PAD_TOP} y2={PAD_TOP} stroke={T.border} strokeDasharray="2 4" />
        <line x1={0} x2={W} y1={H} y2={H} stroke={T.borderStrong} />
        {rows.map((row, i) => {
          const x = i * slot + gap / 2;
          const top = y(row.calls);
          return (
            <g key={row.day}>
              {row.calls > 0 && (
                <path d={barPath(x, top)} fill={T.cyan} opacity={hover == null || hover === i ? 1 : 0.45} />
              )}
              <rect
                x={i * slot} y={0} width={slot} height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={0}
                aria-label={`${row.day}: ${row.calls} calls, ${row.errors} errors`}
              />
            </g>
          );
        })}
        {[0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          rows[i] ? (
            <text
              key={i}
              x={i * slot + slot / 2}
              y={H + 14}
              textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}
              fontSize={TYPE.micro}
              fill={T.green}
            >
              {label(rows[i].day)}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function AiConnections() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [eventFilter, setEventFilter] = useState<"all" | "discovery" | "problems">("all");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const daysRef = useRef(days);
  daysRef.current = days;
  const isMobile = useIsMobile();

  const load = useCallback(async (d: number) => {
    const res = await fetch(`/api/admin/mcp-connections?days=${d}`, { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string })?.error || `HTTP ${res.status}`);
    if (d === daysRef.current) {
      setData(j as Report);
      setError(null);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    load(days)
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : "Load failed"); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [days, load]);

  // Poll while the tab is visible; catch up immediately on re-focus.
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => { void load(daysRef.current).catch(() => { /* keep the last good report */ }); };
    const start = () => { if (timer == null) timer = window.setInterval(tick, POLL_MS); };
    const stop = () => { if (timer != null) { window.clearInterval(timer); timer = undefined; } };
    const onVis = () => { if (document.hidden) stop(); else { tick(); start(); } };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); stop(); };
  }, [load]);

  const refresh = useCallback(() => load(daysRef.current), [load]);
  const { trigger, label: refreshLabel, style: refreshStyle } = useRefreshButton(refresh);

  // Two clicks to disconnect: the first arms the button for a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  const disconnect = async (c: Connection) => {
    if (confirming !== c.familyId) { setConfirming(c.familyId); return; }
    setConfirming(null);
    setBusy(c.familyId);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/mcp-connections/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId: c.familyId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string })?.error || `HTTP ${res.status}`);
      await load(daysRef.current);
    } catch (e) {
      setActionError(`Could not disconnect ${c.email || "that connection"}: ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const disconnectButton = (c: Connection) => {
    const armed = confirming === c.familyId;
    return (
      <button
        type="button"
        disabled={busy === c.familyId}
        onClick={() => void disconnect(c)}
        title="Revokes this connection. The member's app will ask them to reconnect."
        style={{
          ...homeSecondaryButtonStyle,
          padding: "4px 12px",
          fontSize: TYPE.label,
          color: armed ? T.red : T.text,
          borderColor: armed ? ownerRgba(T.red, 0.5) : T.border,
          background: armed ? ownerRgba(T.red, 0.12) : homeSecondaryButtonStyle.background,
          cursor: busy === c.familyId ? "wait" : "pointer",
        }}
      >
        {busy === c.familyId ? "Disconnecting…" : armed ? "Confirm disconnect" : "Disconnect"}
      </button>
    );
  };

  const connections = useMemo(() => {
    const rows = data?.connections ?? [];
    return showAll ? rows : rows.filter((c) => c.status === "live" || c.status === "pending" || c.status === "unclaimed");
  }, [data, showAll]);

  const events = useMemo(() => {
    const rows = data?.events ?? [];
    if (eventFilter === "problems") return rows.filter((e) => EVENT[e.kind]?.problem);
    if (eventFilter === "discovery") return rows.filter((e) => e.kind === "probe");
    return rows;
  }, [data, eventFilter]);

  const t = data?.totals;
  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? `${days}d`;
  const windowWord = days === 1 ? "today" : `in ${rangeLabel}`;

  return (
    <PageShell className="no-card-lift">
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: TYPE.title, fontWeight: 800, letterSpacing: "0.01em" }}>AI Connections</span>
            {data && (
              data.connectorOn
                ? <Pill color={T.green} icon="●" label="Connector on" title="https://www.cbedge.net/mcp is accepting connections." />
                : <Pill color={T.red} icon="✕" label="Connector off (MCP_CONNECTOR=0)" title="New connections and tool calls are switched off on the server." />
            )}
          </div>
          <span style={{ fontSize: TYPE.label, color: T.green }}>
            Gemini · ChatGPT · Claude, via <span style={mono}>www.cbedge.net/mcp</span>
            {data && <> · up to {data.maxGrants} connections per member · updated {new Date(data.generatedAt).toLocaleTimeString()}</>}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Segmented value={days} options={RANGES.map((r) => ({ value: r.days, label: r.label }))} onChange={setDays} />
          <button type="button" onClick={() => void trigger()} style={{ ...refreshStyle, padding: "6px 12px", fontSize: TYPE.label }}>
            {refreshLabel}
          </button>
        </div>
      </div>

      {error && (
        <Card variant="classic" padding="12px 16px" style={{ borderColor: ownerRgba(T.red, 0.45) }}>
          <span style={{ color: T.red, fontSize: TYPE.body }}>Could not load the tracker: {error}</span>
        </Card>
      )}

      {loading && !data && !error && <Card variant="classic"><Empty>Loading connections…</Empty></Card>}

      {data && t && (
        <>
          {/* Headline numbers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Tile label="Live connections" value={fmt(t.live)} sub={`${fmt(t.members)} member${t.members === 1 ? "" : "s"}`} />
            <Tile label="Tool calls" value={fmt(t.calls)} sub={`${windowWord} · ${fmt(t.calls24h)} in 24h · ${fmt(t.activeMembers)} active`} />
            <Tile
              label="Failed calls"
              value={fmt(t.errors)}
              tone={t.errors ? T.orange : undefined}
              sub={t.calls ? `${((t.errors / t.calls) * 100).toFixed(1)}% of calls` : windowWord}
            />
            <Tile label="New app registrations" value={fmt(t.registrations)} sub={`${fmt(t.registrationsUsed)} went on to connect`} />
            <Tile label="Refused" value={fmt(t.refused)} tone={t.refused ? T.orange : undefined} sub="registrations, sign-in links, tokens" />
            <Tile
              label="Approved, never collected"
              value={fmt(t.unclaimed)}
              tone={t.unclaimed ? T.orange : undefined}
              sub="consent given, app never took its tokens"
            />
            <Tile
              label="Reached the connector"
              value={fmt(t.probeCallers ?? 0)}
              sub={`caller${t.probeCallers === 1 ? "" : "s"} · ${fmt(t.probes ?? 0)} discovery hits ${windowWord}`}
            />
          </div>

          {/* Connections */}
          <Card
            variant="classic"
            title="Connections"
            subtitle={showAll
              ? "Every grant still on file, live first."
              : "Live connections, plus approvals the app has not collected yet."}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ fontSize: TYPE.label, color: T.green }}>
                {data.apps.filter((a) => a.live > 0).map((a) => `${APP[a.app].label} ${a.live}`).join(" · ") || "No live connections"}
              </span>
              <Segmented
                value={showAll ? "all" : "live"}
                options={[{ value: "live", label: "Live" }, { value: "all", label: "All" }] as const}
                onChange={(v) => setShowAll(v === "all")}
              />
            </div>
            {actionError && <div style={{ color: T.red, fontSize: TYPE.body, marginBottom: 8 }}>{actionError}</div>}
            {connections.length === 0 ? (
              <Empty>
                {showAll ? "Nobody has connected an AI app yet." : "No live connections. Switch to All to see revoked and expired ones."}
              </Empty>
            ) : isMobile ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {connections.map((c) => {
                  const s = STATUS[c.status];
                  return (
                    <div key={`${c.status}:${c.familyId}`} style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: TYPE.body, overflowWrap: "anywhere" }}>{c.email || c.userId}</span>
                        <Pill color={s.color} icon={s.icon} label={s.label} title={s.hint} />
                      </div>
                      <AppTag app={c.app} name={c.appName} />
                      <span style={subText}>
                        connected {ago(c.connectedAt, now)} · {c.lastUsedAt ? `last used ${ago(c.lastUsedAt, now)}` : "not used yet"} · {fmt(c.calls)} call{c.calls === 1 ? "" : "s"} {rangeLabel}
                        {c.errors > 0 ? ` (${fmt(c.errors)} failed)` : ""}
                        {c.revokedReason ? ` · ${c.revokedReason}` : ""}
                      </span>
                      {c.status === "live" && <div>{disconnectButton(c)}</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Member", "App", "Status", "Connected", "Last used", `Calls ${rangeLabel}`, "Last tool", ""].map((h) => (
                        <th key={h} style={{ ...headStyle, textAlign: h.startsWith("Calls") ? "right" : "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((c) => {
                      const s = STATUS[c.status];
                      return (
                        <tr key={`${c.status}:${c.familyId}`}>
                          <td style={cellStyle}>
                            <div style={{ fontWeight: 600 }}>{c.email || c.userId}</div>
                          </td>
                          <td style={cellStyle}><AppTag app={c.app} name={c.appName} /></td>
                          <td style={cellStyle}>
                            <Pill color={s.color} icon={s.icon} label={s.label} title={s.hint} />
                            {c.revokedReason && <div style={{ ...subText, marginTop: 4 }}>{c.revokedReason} · {ago(c.revokedAt, now)}</div>}
                            {c.status === "live" && c.expiresAt && (
                              <div style={{ ...subText, marginTop: 4 }} title="Refresh window — every use pushes it out again.">
                                renews by {stamp(c.expiresAt)}
                              </div>
                            )}
                          </td>
                          <td style={cellStyle} title={stamp(c.connectedAt)}>{ago(c.connectedAt, now)}</td>
                          <td style={cellStyle} title={stamp(c.lastUsedAt)}>{ago(c.lastUsedAt, now)}</td>
                          <td style={{ ...cellStyle, ...mono, textAlign: "right" }}>
                            {fmt(c.calls)}
                            {c.errors > 0 && <div style={{ ...subText, color: T.orange }}>{fmt(c.errors)} failed</div>}
                          </td>
                          <td style={{ ...cellStyle, ...mono, fontSize: TYPE.label }}>{c.lastTool || "—"}</td>
                          <td style={{ ...cellStyle, textAlign: "right" }}>
                            {c.status === "live" && disconnectButton(c)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Usage */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
            <Card variant="classic" title="Tool calls per day" subtitle={`Last ${data.chartDays} days, New York time`}>
              <DailyBars rows={data.daily} />
            </Card>
            <Card variant="classic" title="Tools" subtitle={`Every tool the connector offers · calls ${windowWord}`}>
              {data.tools.length === 0 ? (
                <Empty>No tools reported.</Empty>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Tool", "Calls", "Failed", "Avg", "Members"].map((h) => (
                          <th key={h} style={{ ...headStyle, textAlign: h === "Tool" ? "left" : "right" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.tools.map((r) => (
                        <tr key={r.tool}>
                          <td style={{ ...cellStyle, ...mono, color: r.calls ? T.text : T.green }}>
                            {r.tool}
                            {r.offered === false && <span style={{ ...subText, marginLeft: 8 }}>retired</span>}
                          </td>
                          <td style={{ ...cellStyle, ...mono, textAlign: "right", color: r.calls ? T.text : T.green }}>{fmt(r.calls)}</td>
                          <td style={{ ...cellStyle, ...mono, textAlign: "right", color: r.errors ? T.orange : T.text }}>{fmt(r.errors)}</td>
                          <td style={{ ...cellStyle, ...mono, textAlign: "right" }}>{r.avgMs != null ? `${fmt(r.avgMs)} ms` : "—"}</td>
                          <td style={{ ...cellStyle, ...mono, textAlign: "right" }}>{fmt(r.members)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Activity */}
          <Card
            variant="classic"
            title="Activity"
            subtitle="Every step of a connection — reaching /mcp, registering, sign-in, Allow — plus disconnects and every refusal with what the app sent. An app with no row here never reached the server."
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <Segmented
                value={eventFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "discovery", label: "Discovery" },
                  { value: "problems", label: "Problems" },
                ] as const}
                onChange={setEventFilter}
              />
            </div>
            {events.length === 0 ? (
              <Empty>
                {eventFilter === "problems"
                  ? `No refusals ${windowWord}.`
                  : eventFilter === "discovery"
                    ? `No app reached the connector ${windowWord}.`
                    : `Nothing logged ${windowWord}.`}
              </Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", maxHeight: 560, overflowY: "auto" }}>
                {events.map((e) => {
                  const k = EVENT[e.kind] ?? { label: e.kind, icon: "•", color: T.text, problem: false };
                  const sameAsApp = !!e.app && !!e.clientName && e.clientName.toLowerCase() === APP[e.app].label.toLowerCase();
                  const who = e.email || (sameAsApp ? "" : e.clientName) || e.ip || "";
                  return (
                    <details key={e.id} style={{ borderBottom: `1px solid ${T.border}`, padding: "8px 2px" }}>
                      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ ...mono, fontSize: TYPE.label, color: T.green, minWidth: 118 }} title={e.at}>{stamp(e.at)}</span>
                        <Pill color={k.color} icon={k.icon} label={k.label} />
                        {e.app && <AppTag app={e.app} />}
                        {who && <span style={{ fontSize: TYPE.body, fontWeight: 600 }}>{who}</span>}
                        <span style={{ fontSize: TYPE.label, color: T.green, flex: "1 1 260px", minWidth: 0, overflowWrap: "anywhere" }}>
                          {eventSummary(e)}
                        </span>
                      </summary>
                      <pre style={{
                        ...mono, fontSize: TYPE.label, color: T.text, background: T.panelInset, border: `1px solid ${T.border}`,
                        borderRadius: 10, padding: "10px 12px", marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                      }}>
                        {JSON.stringify({ at: e.at, kind: e.kind, client_id: e.clientId, ip: e.ip, ...(e.detail || {}) }, null, 2)}
                      </pre>
                    </details>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Registered apps */}
          <Card
            variant="classic"
            title="Registered apps"
            subtitle={`Automatic app registrations ${windowWord}. One that never connects is deleted after 7 days.`}
          >
            {data.clients.length === 0 ? (
              <Empty>No app registered {windowWord}.</Empty>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["App", "Registered", "First connected", "Connections", "Auth", "Callbacks"].map((h) => (
                        <th key={h} style={{ ...headStyle, textAlign: h === "Connections" ? "right" : "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.clients.map((c) => (
                      <tr key={c.clientId}>
                        <td style={cellStyle} title={c.clientId}><AppTag app={c.app} name={c.name} /></td>
                        <td style={cellStyle} title={stamp(c.createdAt)}>{ago(c.createdAt, now)}</td>
                        <td style={{ ...cellStyle, color: c.firstUsedAt ? T.text : T.orange }} title={stamp(c.firstUsedAt)}>
                          {c.firstUsedAt ? ago(c.firstUsedAt, now) : "never"}
                        </td>
                        <td style={{ ...cellStyle, ...mono, textAlign: "right" }}>{fmt(c.connections)}</td>
                        <td style={{ ...cellStyle, ...mono, fontSize: TYPE.label }}>{c.authMethod}</td>
                        <td style={{ ...cellStyle, fontSize: TYPE.label, whiteSpace: "normal", minWidth: 280 }}>
                          <span style={mono}>{c.callbacks}</span> <span style={{ color: T.green }}>· {c.hosts.join(", ")}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}
