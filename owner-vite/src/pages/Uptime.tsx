import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OWNER_THEME as T, ownerRgba, homeSecondaryButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * UPTIME — CB Edge and Vela, measured from outside by UptimeRobot.
 *
 * Brandon, 2026-10-09: "add an uptime tracker for cbedge and vela in the
 * backend owner.cbedge.net site · keys will be put into the .env.local".
 * Modelled on Voltick's admin Uptime tab (worst uptime / monitors up /
 * outages / next certificate, then the monitor table, outages and certs).
 *
 * Reads ONE route: GET /api/owner/uptime (server-v2/uptime-robot.cjs, owner-
 * gated, held 60 s server-side). Keys live in .env.local as
 * UPTIMEROBOT_API_KEY (one account key, monitors split by URL), with optional
 * per-site UPTIMEROBOT_KEY_CBEDGE / _VELA; a site without one shows the line
 * to add rather than an error.
 *
 * Colour: up = OWNER_THEME.green, degraded / cert under 21 d = gold,
 * down = red. Secondary text green, recessive step cyan (AGENTS.md).
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Level = "ok" | "warn" | "down";
type MonStatus = "up" | "down" | "seems_down" | "paused" | "pending" | "unknown";
interface UptimeLog { type: "down" | "up" | "started" | "paused" | string; at: number | null; durationSec: number | null; reason: string | null }
interface Monitor {
  id: number; name: string; url: string | null; host: string | null; status: MonStatus;
  intervalSec: number | null; uptime1d: number | null; uptime7d: number | null; uptime30d: number | null;
  p50Ms: number | null; p95Ms: number | null; lastCheckAt: number | null;
  responseTimes: { at: number; ms: number }[];
  ssl: { expiresAt: number; brand: string | null } | null;
  logs: UptimeLog[];
}
interface Site { key: string; label: string; env: string; configured: boolean; monitors: Monitor[]; errors?: string[] }
interface UptimeBody { asOf: string; heldAt: number; holdMs: number; sites: Site[]; error?: string }
type Row = Monitor & { site: string };

const POLL_MS = 60_000;
const DAY = 86_400_000;
const CERT_WARN_DAYS = 21;

// ── formatting ──
function ago(ms: number | null | undefined, now: number): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function dur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const pctTxt = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const msTxt = (v: number | null) => (v == null ? "—" : `${Math.round(v)} ms`);
const dateTxt = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const stamp = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const LEVEL_COLOR: Record<Level, string> = { ok: T.green, warn: T.gold, down: T.red };
const STATUS_LEVEL: Record<MonStatus, Level> = { up: "ok", seems_down: "warn", pending: "warn", paused: "warn", unknown: "warn", down: "down" };
const STATUS_LABEL: Record<MonStatus, string> = { up: "UP", down: "DOWN", seems_down: "SEEMS DOWN", paused: "PAUSED", pending: "PENDING", unknown: "?" };
const uptimeLevel = (v: number | null): Level => (v == null ? "warn" : v >= 99.9 ? "ok" : v >= 99 ? "warn" : "down");

// ── small pieces ──
const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const th: CSSProperties = { textAlign: "left", fontWeight: 600, fontSize: 12, color: T.green, padding: "8px 10px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", letterSpacing: "0.08em", textTransform: "uppercase" };
const td: CSSProperties = { padding: "10px 10px", borderBottom: `1px solid ${ownerRgba("#FFFFFF", 0.05)}`, fontSize: 13, verticalAlign: "middle", whiteSpace: "nowrap" };
const cardPad = 18;

function Pill({ level, children }: { level: Level; children: ReactNode }) {
  const c = LEVEL_COLOR[level];
  return (
    <span style={{ ...mono, display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 6, border: `1px solid ${ownerRgba(c, 0.55)}`, background: ownerRgba(c, 0.12), color: c }}>
      {children}
    </span>
  );
}

function Tile({ label, value, sub, level }: { label: string; value: string; sub: string; level?: Level }) {
  return (
    <div style={{ background: T.panelInset, border: `1px solid ${level && level !== "ok" ? ownerRgba(LEVEL_COLOR[level], 0.5) : T.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ ...mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.green }}>{label}</span>
      <span style={{ ...mono, fontSize: 26, fontWeight: 800, color: level ? LEVEL_COLOR[level] : T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      <span style={{ fontSize: 12, color: T.cyan, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sub}>{sub}</span>
    </div>
  );
}

/** Response time over the recent checks — a line, no axes; the numbers are in the P50/P95 columns. */
function Spark({ pts }: { pts: { at: number; ms: number }[] }) {
  const W = 120, H = 26;
  if (pts.length < 2) return <span style={{ color: T.cyan, fontSize: 12 }}>—</span>;
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at || t0 + 1;
  const max = Math.max(...pts.map((p) => p.ms)), min = Math.min(...pts.map((p) => p.ms));
  const span = Math.max(1, max - min);
  const d = pts.map((p, i) => {
    const x = ((p.at - t0) / Math.max(1, t1 - t0)) * W;
    const y = H - 2 - ((p.ms - min) / span) * (H - 4);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label={`response time ${Math.round(min)}–${Math.round(max)} ms`}>
      <path d={d} fill="none" stroke={T.cyan} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

const SITE_TABS = [
  { key: "all", label: "All" },
  { key: "cbedge", label: "CB Edge" },
  { key: "vela", label: "Vela" },
] as const;
type SiteTab = (typeof SITE_TABS)[number]["key"];

export default function Uptime() {
  const [data, setData] = useState<UptimeBody | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<SiteTab>("all");
  const inflight = useRef(false);
  const isMobile = useIsMobile();

  const load = useCallback(async (fresh = false) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const r = await fetch(`/api/owner/uptime${fresh ? "?fresh=1" : ""}`, { cache: "no-store", credentials: "include" });
      const body = (await r.json().catch(() => null)) as UptimeBody | null;
      if (!r.ok || !body || body.error) {
        throw new Error(r.status === 404 ? "/api/owner/uptime is not on the running server yet — deploy server-v2." : body?.error || `HTTP ${r.status}`);
      }
      setData(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const c = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearInterval(t); window.clearInterval(c); };
  }, [load]);

  const sites = useMemo(() => (data?.sites ?? []).filter((s) => tab === "all" || s.key === tab), [data, tab]);
  const rows: Row[] = useMemo(() => sites.flatMap((s) => s.monitors.map((m) => ({ ...m, site: s.label }))), [sites]);
  const unconfigured = sites.filter((s) => !s.configured);
  const failing = sites.filter((s) => s.errors?.length);

  const stats = useMemo(() => {
    const ups = rows.map((r) => r.uptime30d).filter((v): v is number => v != null);
    const worst = ups.length ? Math.min(...ups) : null;
    const up = rows.filter((r) => r.status === "up").length;
    const live = rows.filter((r) => r.status !== "paused");
    const downNow = rows.filter((r) => r.status === "down" || r.status === "seems_down");
    const outages = rows
      .flatMap((r) => r.logs.filter((l) => l.type === "down" && l.at != null).map((l) => ({ ...l, at: l.at as number, monitor: r.name, site: r.site })))
      .sort((a, b) => b.at - a.at);
    const outages30 = outages.filter((o) => now - o.at <= 30 * DAY);
    const certs = rows
      .filter((r) => r.ssl)
      .map((r) => ({ monitor: r.name, site: r.site, host: r.host ?? r.url ?? r.name, expiresAt: r.ssl!.expiresAt, brand: r.ssl!.brand }))
      .sort((a, b) => a.expiresAt - b.expiresAt);
    return { worst, up, live: live.length, downNow, outages, outages30, certs };
  }, [rows, now]);

  const nextCert = stats.certs[0];
  const nextCertDays = nextCert ? Math.floor((nextCert.expiresAt - now) / DAY) : null;
  const tabBtn = (key: SiteTab): CSSProperties => ({
    ...homeSecondaryButtonStyle, padding: "6px 14px", fontSize: 13,
    border: `1px solid ${tab === key ? T.cyan : T.border}`,
    background: tab === key ? ownerRgba(T.cyan, 0.18) : "transparent",
    color: tab === key ? T.cyan : T.text,
  });

  return (
    <PageShell>
      {/* ── header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Uptime</span>
          <span style={{ fontSize: 13, color: T.green }}>
            Measured from outside by UptimeRobot · {data ? `read ${ago(data.heldAt, now)}` : "reading…"}, held a minute for every admin · a server can't time its own downtime
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SITE_TABS.map((s) => (
            <button key={s.key} type="button" onClick={() => setTab(s.key)} style={tabBtn(s.key)}>{s.label}</button>
          ))}
          <button type="button" disabled={busy} onClick={() => void load(true)} style={{ ...homeSecondaryButtonStyle, padding: "6px 12px", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      {err && (
        <Card variant="classic" padding={cardPad} style={{ borderColor: ownerRgba(T.red, 0.6) }}>
          <span style={{ fontSize: 14, color: T.red }}>{err}</span>
        </Card>
      )}

      {(unconfigured.length > 0 || failing.length > 0) && (
        <Card variant="classic" padding={cardPad} style={{ borderColor: ownerRgba(T.gold, 0.5) }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            {unconfigured.map((s) => (
              <span key={s.key} style={{ color: T.text }}>
                <b style={{ color: T.gold }}>{s.label}</b> — no key. Add <code style={{ ...mono, color: T.cyan }}>UPTIMEROBOT_API_KEY=…</code> to <code style={mono}>.env.local</code> on the VPS (your UptimeRobot account key; monitors are split by URL — "vela" → Vela, "cbedge" → CB Edge) and restart the dashboard.
              </span>
            ))}
            {failing.map((s) => (
              <span key={s.key} style={{ color: T.text }}>
                <b style={{ color: T.red }}>{s.label}</b> — {s.errors!.join(" · ")}
              </span>
            ))}
          </div>
        </Card>
      )}

      {!data && !err && <div style={{ color: T.green, fontSize: 14 }}>Checking…</div>}

      {data && (
        <>
          {/* ── tiles ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: isMobile ? 8 : 12 }}>
            <Tile
              label="Worst uptime · 30d"
              value={pctTxt(stats.worst)}
              sub={stats.worst == null ? "no monitors yet" : `about ${dur(((100 - stats.worst) / 100) * 30 * 86_400)} down`}
              level={stats.worst == null ? undefined : uptimeLevel(stats.worst)}
            />
            <Tile
              label="Monitors up"
              value={`${stats.up}/${stats.live}`}
              sub={stats.downNow.length ? `down: ${stats.downNow.map((r) => r.name).join(", ")}` : "right now"}
              level={!stats.live ? undefined : stats.downNow.length ? "down" : stats.up < stats.live ? "warn" : "ok"}
            />
            <Tile
              label="Outages · 30d"
              value={String(stats.outages30.length)}
              sub={stats.outages30.length ? `last ${ago(stats.outages30[0].at, now)} · ${stats.outages30[0].monitor}` : "none in the log"}
              level={stats.outages30.length ? "warn" : undefined}
            />
            <Tile
              label="Next certificate"
              value={nextCertDays == null ? "—" : `${nextCertDays}d`}
              sub={nextCert ? `${nextCert.host} · ${dateTxt(nextCert.expiresAt)}` : "no certificate dates"}
              level={nextCertDays == null ? undefined : nextCertDays < 7 ? "down" : nextCertDays < CERT_WARN_DAYS ? "warn" : "ok"}
            />
          </div>

          {/* ── monitors ── */}
          <Card variant="classic" padding={cardPad} title="Monitors" subtitle="Response time over UptimeRobot's recent checks · uptime over 1, 7 and 30 days">
            {rows.length === 0 ? (
              <div style={{ color: T.green, fontSize: 14, padding: "18px 0", textAlign: "center" }}>
                {unconfigured.length === sites.length ? "No keys set for this view yet." : "No monitors on these keys."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th style={th}>Site</th>
                      <th style={th}>Monitor</th>
                      <th style={th}>URL</th>
                      <th style={th}>Status</th>
                      <th style={th}>Recent</th>
                      <th style={{ ...th, textAlign: "right" }}>P50</th>
                      <th style={{ ...th, textAlign: "right" }}>P95</th>
                      <th style={{ ...th, textAlign: "right" }}>24h</th>
                      <th style={{ ...th, textAlign: "right" }}>7d</th>
                      <th style={{ ...th, textAlign: "right" }}>30d</th>
                      <th style={th}>Checks</th>
                      <th style={th}>Last check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.site}:${r.id}`}>
                        <td style={{ ...td, color: T.green }}>{r.site}</td>
                        <td style={{ ...td, color: T.text, fontWeight: 700 }}>{r.name}</td>
                        <td style={{ ...td, ...mono, color: T.cyan, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={r.url ?? undefined}>{r.url ?? "—"}</td>
                        <td style={td}><Pill level={STATUS_LEVEL[r.status] ?? "warn"}>{STATUS_LABEL[r.status] ?? r.status}</Pill></td>
                        <td style={td}><Spark pts={r.responseTimes} /></td>
                        <td style={{ ...td, ...mono, textAlign: "right", color: T.text, fontWeight: 700 }}>{msTxt(r.p50Ms)}</td>
                        <td style={{ ...td, ...mono, textAlign: "right", color: T.text, fontWeight: 700 }}>{msTxt(r.p95Ms)}</td>
                        <td style={{ ...td, ...mono, textAlign: "right", color: LEVEL_COLOR[uptimeLevel(r.uptime1d)] }}>{pctTxt(r.uptime1d)}</td>
                        <td style={{ ...td, ...mono, textAlign: "right", color: LEVEL_COLOR[uptimeLevel(r.uptime7d)] }}>{pctTxt(r.uptime7d)}</td>
                        <td style={{ ...td, ...mono, textAlign: "right", fontWeight: 800, color: LEVEL_COLOR[uptimeLevel(r.uptime30d)] }}>{pctTxt(r.uptime30d)}</td>
                        <td style={{ ...td, color: T.text }}>{r.intervalSec ? `every ${Math.round(r.intervalSec / 60)} min` : "—"}</td>
                        <td style={{ ...td, color: T.text }}>{ago(r.lastCheckAt, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 12 }}>
            {/* ── outages ── */}
            <Card variant="classic" padding={cardPad} title="Outages" subtitle={`Each time a monitor went down, newest first · the last ${20} per monitor`}>
              {stats.outages.length === 0 ? (
                <div style={{ color: T.text, fontSize: 14, padding: "18px 0", textAlign: "center" }}>No outages in the log.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th style={th}>When</th><th style={th}>Monitor</th><th style={th}>Lasted</th><th style={th}>Reason</th></tr></thead>
                    <tbody>
                      {stats.outages.slice(0, 40).map((o, i) => (
                        <tr key={`${o.monitor}:${o.at}:${i}`}>
                          <td style={{ ...td, ...mono, color: T.text }}>{stamp(o.at)}</td>
                          <td style={{ ...td, color: T.text }}>{o.monitor} <span style={{ color: T.green }}>· {o.site}</span></td>
                          <td style={{ ...td, ...mono, color: T.red, fontWeight: 700 }}>{dur(o.durationSec)}</td>
                          <td style={{ ...td, color: T.cyan, whiteSpace: "normal" }}>{o.reason ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ── certificates ── */}
            <Card variant="classic" padding={cardPad} title="Certificates" subtitle={`When each site's certificate runs out · amber under ${CERT_WARN_DAYS} days`}>
              {stats.certs.length === 0 ? (
                <div style={{ color: T.text, fontSize: 14, padding: "18px 0", textAlign: "center" }}>No certificate dates reported.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th style={th}>Host</th><th style={th}>Issuer</th><th style={th}>Expires</th><th style={{ ...th, textAlign: "right" }}>Left</th></tr></thead>
                    <tbody>
                      {stats.certs.map((c) => {
                        const days = Math.floor((c.expiresAt - now) / DAY);
                        const lvl: Level = days < 7 ? "down" : days < CERT_WARN_DAYS ? "warn" : "ok";
                        return (
                          <tr key={`${c.site}:${c.monitor}`}>
                            <td style={{ ...td, ...mono, color: T.text }}>{c.host} <span style={{ color: T.green, fontFamily: "inherit" }}>· {c.site}</span></td>
                            <td style={{ ...td, color: T.cyan }}>{c.brand ?? "—"}</td>
                            <td style={{ ...td, ...mono, color: T.text }}>{dateTxt(c.expiresAt)}</td>
                            <td style={{ ...td, ...mono, textAlign: "right", fontWeight: 800, color: LEVEL_COLOR[lvl] }}>{days}d</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
