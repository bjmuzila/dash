import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OWNER_THEME as T, ownerRgba, homeSecondaryButtonStyle } from "../lib/theme";
import { PageShell, Card } from "../components/PageCard";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VELA HEALTH — the box behind vela.cbedge.net, in one screen.
 *
 * Brandon, 2026-10-08: "does Vela have like a /healthz that can show all the
 * API stuff … anything that Voltick will show" → "build that and then also put
 * the monitors on the owner site under the Vela dashboard".
 *
 * Reads ONE route: GET /api/healthz (server-v2/healthz.cjs, owner-gated, held
 * 30 s server-side so this page and a curl never build it twice in a breath),
 * plus /api/healthz/ready — the cheap public check an outside monitor should
 * watch — so the page shows exactly what that monitor would see.
 *
 * Polls every 30 s. "Rebuild now" asks for ?fresh=1. The strip under the header
 * is this tab's own memory of each poll's verdict (nothing stored server-side),
 * so a flap while the page sat open is visible at a glance.
 *
 * Colour: ok = OWNER_THEME.green (the same dot SystemHealth uses), warn = gold,
 * down = red. Secondary text is green, the recessive step cyan — no opacity
 * greys (AGENTS.md "Colour, on this surface").
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Level = "ok" | "warn" | "down";
interface Problem { code: string; level: "warn" | "down"; note?: string }
interface Recorder {
  table: string; state: "ok" | "stale" | "empty" | "error"; newestAt?: string | null; ageSec?: number | null;
  maxAgeSec?: number; error?: string; symbols?: Record<string, Recorder & { table?: string }>;
}
interface Health {
  ok: boolean; verdict: Level; asOf: string; heldAt: number; rth: boolean;
  build: { version: string | null; node: string };
  feed: {
    error?: string; ttAuthenticated?: boolean; dxlinkConnected?: boolean; idle?: boolean; chartReady?: boolean;
    contractsSubscribed?: number; oiCoveragePct?: number | null; greeksCoveragePct?: number | null;
    lastFeedAgeSec?: number | null; spot?: number | null; spotAgeSec?: number | null; boardAgeSec?: number | null; lastError?: string | null;
  };
  socket: {
    error?: string; clients?: number; mbPerMin?: number; projectedGbPerDay?: number; connectsLastMin?: number;
    totalConnects?: number; snapshotPct?: number; top?: { type: string; kb: number; pct: number }[];
  };
  process: {
    uptimeSec: number; startedAt: string; node: string; rssMb: number; peakRssMb: number; heapMb: number; heapTotalMb: number; externalMb: number;
    loop: { p50Ms: number; p99Ms: number; maxMs: number; windowSec: number; stalls: number; worstStallMs: number; recentStalls: { at: string; ms: number }[] };
  };
  db: { ok: boolean; latencyMs: number; error?: string; pool?: { total: number; idle: number; waiting: number; max: number | null } | null; sizeMb?: number | null; connections?: number | null };
  recorders: Record<string, Recorder>;
  vela: {
    usage: { error?: string; sessions15m?: number; events1h?: number; people24h?: number; newestEventAgeSec?: number | null };
    history?: Record<string, unknown> & { error?: string };
    chains?: Record<string, unknown> & { error?: string };
  };
  probes: Record<string, Record<string, unknown> & { error?: string; problems?: Problem[] }>;
  env: Record<string, string | number | boolean | null>;
  problems: Problem[];
}
interface Ready { ok: boolean; rth: boolean; reasons: string[]; dbMs: number | null; feed: { spotAgeSec: number | null; feedAgeSec: number | null } | null }

const POLL_MS = 30_000;
const STRIP_MAX = 60;

// ── formatting ──
function dur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const num = (v: unknown, d = "—") => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString() : d);
const clock = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
};
const LEVEL_COLOR: Record<Level, string> = { ok: T.green, warn: T.gold, down: T.red };
const STATE_LEVEL: Record<string, Level> = { ok: "ok", stale: "warn", empty: "warn", error: "down" };

// ── small pieces ──
const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const th: CSSProperties = { textAlign: "left", fontWeight: 600, fontSize: 12, color: T.green, padding: "6px 8px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${ownerRgba("#FFFFFF", 0.05)}`, fontSize: 13, verticalAlign: "top" };

function Dot({ level, size = 9 }: { level: Level; size?: number }) {
  const c = LEVEL_COLOR[level];
  return <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${ownerRgba(c, 0.6)}`, flex: "0 0 auto", display: "inline-block" }} />;
}

function Pill({ level, children }: { level: Level; children: ReactNode }) {
  const c = LEVEL_COLOR[level];
  return (
    <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", padding: "3px 10px", borderRadius: 999, border: `1px solid ${ownerRgba(c, 0.55)}`, background: ownerRgba(c, 0.12), color: T.text }}>
      <Dot level={level} size={7} />{children}
    </span>
  );
}

/** One monitor: a dot, a name, the headline number, one line under it. */
function Monitor({ level, name, value, sub, compact }: { level: Level; name: string; value: string; sub?: string; compact?: boolean }) {
  return (
    <div style={{ background: T.panelInset, border: `1px solid ${level === "ok" ? T.border : ownerRgba(LEVEL_COLOR[level], 0.5)}`, borderRadius: 12, padding: compact ? "10px 11px" : "12px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dot level={level} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>{name}</span>
      </div>
      <span style={{ ...mono, fontSize: compact ? 16 : 20, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: T.cyan, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sub}>{sub}</span>}
    </div>
  );
}

/** Label / value rows inside a card. */
function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", columnGap: 14, rowGap: 6, fontSize: 13 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: T.green }}>{k}</span>
          <span style={{ ...mono, color: T.text, minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const yes = (b: unknown) => (b ? "yes" : "no");
const cardPad = 18;

// ── the monitors, derived from the body ──
function monitors(h: Health): { level: Level; name: string; value: string; sub?: string }[] {
  const f = h.feed || {};
  const has = (prefix: string, lvl?: "down") => h.problems.some((p) => p.code.startsWith(prefix) && (!lvl || p.level === lvl));
  const lvl = (prefix: string): Level => (has(prefix, "down") ? "down" : has(prefix) ? "warn" : "ok");
  const recs = Object.values(h.recorders || {});
  const recBad = recs.filter((r) => r.state !== "ok").length;
  const s = h.socket || {};
  const l = h.process?.loop;
  const lse = h.probes?.lse;
  const hist = h.vela?.history;
  const chains = h.vela?.chains;
  const u = h.vela?.usage || {};
  return [
    {
      level: f.error ? "down" : lvl("feed."), name: "Feed",
      value: f.error ? "unreachable" : f.idle ? "idle" : f.dxlinkConnected && f.ttAuthenticated ? "live" : "down",
      sub: f.error ? f.error : `dxLink ${f.dxlinkConnected ? "up" : "down"} · TT ${f.ttAuthenticated ? "auth" : "no auth"} · ${num(f.contractsSubscribed)} contracts`,
    },
    {
      level: has("feed.spot") ? (h.rth ? "down" : "warn") : "ok", name: "Spot",
      value: f.spot != null ? f.spot.toFixed(2) : "—",
      sub: `${dur(f.spotAgeSec)} old · board ${dur(f.boardAgeSec)}${h.rth ? "" : " · market closed"}`,
    },
    {
      level: lvl("ws."), name: "Socket",
      value: s.error ? s.error : `${num(s.clients)} clients`,
      sub: s.error ? undefined : `${s.mbPerMin ?? 0} MB/min · ~${s.projectedGbPerDay ?? 0} GB/day · ${num(s.connectsLastMin)} connects/min`,
    },
    {
      level: h.db?.ok ? lvl("db.") : "down", name: "Postgres",
      value: h.db?.ok ? `${h.db.latencyMs} ms` : "down",
      sub: h.db?.ok ? `pool ${h.db.pool ? `${h.db.pool.total - h.db.pool.idle}/${h.db.pool.max ?? "?"} busy · ${h.db.pool.waiting} waiting` : "—"} · ${h.db.sizeMb != null ? `${(h.db.sizeMb / 1024).toFixed(1)} GB` : ""}` : h.db?.error,
    },
    {
      level: recBad ? (recs.some((r) => r.state === "error") ? "down" : "warn") : "ok", name: "Recorders",
      value: `${recs.length - recBad}/${recs.length} fresh`,
      sub: recBad ? recs.filter((r) => r.state !== "ok").map((r) => `${r.table} ${r.state}`).join(" · ") : h.rth ? "all writing" : "judged in RTH only",
    },
    {
      level: lvl("loop."), name: "Event loop",
      value: l ? `p99 ${l.p99Ms} ms` : "—",
      sub: l ? `max ${l.maxMs} ms over ${dur(l.windowSec)} · ${l.stalls} stalls since boot` : undefined,
    },
    {
      level: lvl("mem."), name: "Memory",
      value: h.process ? `${h.process.rssMb} MB` : "—",
      sub: h.process ? `peak ${h.process.peakRssMb} MB · heap ${h.process.heapMb}/${h.process.heapTotalMb} MB` : undefined,
    },
    {
      level: chains?.error ? "warn" : lvl("chains."), name: "Chains cache",
      value: chains?.error ? String(chains.error) : `${num(chains?.keys)} keys`,
      sub: chains?.error ? undefined : `${num(chains?.fresh)} fresh · ${num(chains?.failing)} failing · ${num(chains?.pulls)} pulls / ${num(chains?.fails)} fails`,
    },
    {
      level: hist?.error ? "warn" : lvl("velaHistory."), name: "Vela history",
      value: hist?.error ? String(hist.error) : `${num(hist?.entries)} cached`,
      sub: hist?.error ? undefined : `D/W/M bars · ${num(hist?.fetches)} fetches · ${num(hist?.fails)} fails · ${num(hist?.empty)} empty`,
    },
    {
      level: !lse ? "warn" : lse.error ? "warn" : lvl("lse."), name: "LSE vault",
      value: !lse ? "not loaded" : lse.error ? String(lse.error) : lse.configured ? `${num(lse.used)} / ${num(lse.limit)}` : "no key",
      sub: lse && !lse.error ? `${num(lse.keys)} keys · ${num(lse.exhaustedKeys)} out · ${num(lse.refused)} refused · tape ${String((lse.tape as { mode?: string } | undefined)?.mode ?? "off")}` : undefined,
    },
    {
      level: u.error ? "warn" : "ok", name: "Vela users",
      value: u.error ? u.error : `${num(u.sessions15m)} on now`,
      sub: u.error ? undefined : `${num(u.people24h)} people / 24h · ${num(u.events1h)} events / 1h · last ${dur(u.newestEventAgeSec)} ago`,
    },
    {
      level: lvl("env."), name: "Env flags",
      value: has("env.") ? `${h.problems.filter((p) => p.code.startsWith("env.")).length} off` : "as expected",
      sub: `WS_DEFLATE ${String(h.env?.WS_DEFLATE)} · WS auth ${h.env?.WS_AUTH_REQUIRED ? "on" : "off"}`,
    },
  ];
}

export default function VelaHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [ready, setReady] = useState<{ status: number; body: Ready | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showRaw, setShowRaw] = useState(false);
  const [strip, setStrip] = useState<{ at: number; level: Level; problems: number }[]>([]);
  const inflight = useRef(false);
  const isMobile = useIsMobile();

  const load = useCallback(async (fresh = false) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const [hr, rr] = await Promise.all([
        fetch(`/api/healthz${fresh ? "?fresh=1" : ""}`, { cache: "no-store", credentials: "include" }),
        fetch("/api/healthz/ready", { cache: "no-store", credentials: "include" }).catch(() => null),
      ]);
      const body = (await hr.json().catch(() => null)) as (Health & { error?: string }) | null;
      if (!hr.ok || !body || body.error) {
        // A 404 with an HTML body is the Next fallthrough: the running build predates /api/healthz.
        throw new Error(hr.status === 404 ? "/api/healthz is not on the running server yet — deploy server-v2." : body?.error || `HTTP ${hr.status}`);
      }
      setH(body);
      setErr(null);
      setStrip((s) => [...s, { at: Date.now(), level: body.verdict, problems: body.problems.length }].slice(-STRIP_MAX));
      if (rr) setReady({ status: rr.status, body: (await rr.json().catch(() => null)) as Ready | null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStrip((s) => [...s, { at: Date.now(), level: "down" as Level, problems: -1 }].slice(-STRIP_MAX));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const c = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(t); window.clearInterval(c); };
  }, [load]);

  const verdict: Level = err && !h ? "down" : h?.verdict ?? "warn";
  const mons = h ? monitors(h) : [];
  const recs = h ? Object.entries(h.recorders || {}) : [];

  return (
    <PageShell>
      {/* ── header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Vela Health</span>
          <Pill level={verdict}>{verdict.toUpperCase()}</Pill>
          {ready && (
            <span title="/api/healthz/ready — what an outside monitor sees">
              <Pill level={ready.status === 200 ? "ok" : "down"}>READY {ready.status}</Pill>
            </span>
          )}
          {h && (
            <span style={{ fontSize: 13, color: T.green }}>
              {h.build.version ?? "—"} · up {dur(h.process?.uptimeSec)} · {h.rth ? "market open" : "market closed"} · built {dur((now - h.heldAt) / 1000)} ago
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setShowRaw((v) => !v)} style={{ ...homeSecondaryButtonStyle, padding: "6px 12px", fontSize: 13 }}>
            {showRaw ? "Hide JSON" : "Raw JSON"}
          </button>
          <button type="button" disabled={busy} onClick={() => void load(true)} style={{ ...homeSecondaryButtonStyle, padding: "6px 12px", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Checking…" : "Rebuild now"}
          </button>
        </div>
      </div>

      {/* ── this tab's verdict history ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: isMobile ? 1 : 2, flex: "1 1 220px", minWidth: 0, height: 14 }} aria-label="Verdict per poll, oldest first">
          {Array.from({ length: STRIP_MAX }, (_, i) => {
            const e = strip[i - (STRIP_MAX - strip.length)];
            return (
              <span
                key={i}
                title={e ? `${new Date(e.at).toLocaleTimeString()} · ${e.level}${e.problems > 0 ? ` · ${e.problems} problem${e.problems === 1 ? "" : "s"}` : e.problems < 0 ? " · no answer" : ""}` : undefined}
                style={{ flex: "1 1 0", minWidth: 1, borderRadius: 2, background: e ? LEVEL_COLOR[e.level] : ownerRgba("#FFFFFF", 0.06) }}
              />
            );
          })}
        </div>
        <span style={{ ...mono, fontSize: 12, color: T.cyan, whiteSpace: "nowrap" }}>every {POLL_MS / 1000}s · this tab</span>
      </div>

      {err && (
        <Card variant="classic" padding={cardPad} style={{ borderColor: ownerRgba(T.red, 0.6) }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: T.text }}>
            <Dot level="down" /> {err}
          </div>
        </Card>
      )}

      {!h && !err && <div style={{ color: T.green, fontSize: 14 }}>Checking…</div>}

      {h && (
        <>
          {/* ── problems ── */}
          <Card variant="classic" padding={cardPad} title="Problems" subtitle={h.problems.length ? `${h.problems.length} open · down = a member would notice now, warn = degraded or a setting that will bite` : "Nothing wrong."}>
            {h.problems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {h.problems.map((p) => (
                  <div key={p.code} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
                    <Dot level={p.level} />
                    <span style={{ ...mono, color: T.text, fontWeight: 600 }}>{p.code}</span>
                    {p.note && <span style={{ color: T.green, overflowWrap: "anywhere" }}>{p.note}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ── the monitors ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(min(230px, 100%), 1fr))", gap: isMobile ? 8 : 12 }}>
            {mons.map((m) => <Monitor key={m.name} {...m} compact={isMobile} />)}
          </div>

          {/* ── recorders ── */}
          <Card variant="classic" padding={cardPad} title="Recorders" subtitle={h.rth ? "Newest row each recorder wrote · stale past its limit during RTH" : "Newest row each recorder wrote · ages are only judged 09:30–16:00 ET"}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr><th style={th}>Recorder</th><th style={th}>Table</th><th style={th}>Newest row</th><th style={th}>Age</th><th style={th}>Limit</th><th style={th}>State</th></tr>
                </thead>
                <tbody>
                  {recs.flatMap(([key, r]) => {
                    const rows: ReactNode[] = [];
                    const line = (k: string, label: string, table: string, x: Recorder) => (
                      <tr key={k}>
                        <td style={{ ...td, color: T.text }}>{label}</td>
                        <td style={{ ...td, ...mono, color: T.green }}>{table}</td>
                        <td style={{ ...td, ...mono }}>{x.error ? x.error : clock(x.newestAt)}</td>
                        <td style={{ ...td, ...mono }}>{dur(x.ageSec)}</td>
                        <td style={{ ...td, ...mono, color: T.cyan }}>{x.maxAgeSec ? dur(x.maxAgeSec) : "—"}</td>
                        <td style={td}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Dot level={STATE_LEVEL[x.state] ?? "warn"} size={7} />{x.state}</span></td>
                      </tr>
                    );
                    if (r.symbols) {
                      for (const [sym, x] of Object.entries(r.symbols)) rows.push(line(`${key}:${sym}`, `${key} · ${sym}`, r.table, x));
                    } else rows.push(line(key, key, r.table, r));
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12 }}>
            {/* ── feed ── */}
            <Card variant="classic" padding={cardPad} title="Feed" subtitle="TastyTrade / dxLink, from /proxy/status">
              {h.feed.error ? <span style={{ color: T.text }}>{h.feed.error}</span> : (
                <KV rows={[
                  ["TT auth", yes(h.feed.ttAuthenticated)],
                  ["dxLink", h.feed.dxlinkConnected ? "connected" : "disconnected"],
                  ["Idle switch", h.feed.idle ? "ON — feed paused" : "off"],
                  ["Chart ready", yes(h.feed.chartReady)],
                  ["Contracts", num(h.feed.contractsSubscribed)],
                  ["OI coverage", h.feed.oiCoveragePct != null ? `${h.feed.oiCoveragePct}%` : "—"],
                  ["Greeks coverage", h.feed.greeksCoveragePct != null ? `${h.feed.greeksCoveragePct}%` : "—"],
                  ["Last tick", `${dur(h.feed.lastFeedAgeSec)} ago`],
                  ["Spot", `${h.feed.spot != null ? h.feed.spot.toFixed(2) : "—"} · ${dur(h.feed.spotAgeSec)} old`],
                  ["Last error", h.feed.lastError || "none"],
                ]} />
              )}
            </Card>

            {/* ── socket ── */}
            <Card variant="classic" padding={cardPad} title="/ws/gex" subtitle="Trailing 60 s · the bandwidth alarm's own numbers">
              {h.socket.error ? <span style={{ color: T.text }}>{h.socket.error}</span> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <KV rows={[
                    ["Clients", num(h.socket.clients)],
                    ["Egress", `${h.socket.mbPerMin} MB/min · ~${h.socket.projectedGbPerDay} GB/day`],
                    ["Connects", `${num(h.socket.connectsLastMin)} last min · ${num(h.socket.totalConnects)} since boot`],
                    ["Snapshots", `${num(h.socket.snapshotPct)}% of egress`],
                  ]} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {(h.socket.top ?? []).map((t) => (
                      <div key={t.type} style={{ display: "grid", gridTemplateColumns: "84px 1fr 72px", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <span style={{ ...mono, color: T.green }}>{t.type}</span>
                        <span style={{ height: 6, borderRadius: 3, background: ownerRgba("#FFFFFF", 0.06), overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.max(2, t.pct)}%`, background: T.cyan }} />
                        </span>
                        <span style={{ ...mono, textAlign: "right", color: T.text }}>{t.kb.toLocaleString()} KB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* ── process ── */}
            <Card variant="classic" padding={cardPad} title="Process" subtitle={`node ${h.process.node} · started ${new Date(h.process.startedAt).toLocaleString()}`}>
              <KV rows={[
                ["Memory", `${h.process.rssMb} MB rss · peak ${h.process.peakRssMb} MB`],
                ["Heap", `${h.process.heapMb} / ${h.process.heapTotalMb} MB · external ${h.process.externalMb} MB`],
                ["Loop delay", `p50 ${h.process.loop.p50Ms} · p99 ${h.process.loop.p99Ms} · max ${h.process.loop.maxMs} ms (last ${dur(h.process.loop.windowSec)})`],
                ["Stalls", `${h.process.loop.stalls} over 250 ms since boot · worst ${h.process.loop.worstStallMs} ms`],
                ["Recent", h.process.loop.recentStalls.length ? h.process.loop.recentStalls.slice(-5).reverse().map((s) => `${clock(s.at)} ${s.ms}ms`).join(" · ") : "none"],
              ]} />
            </Card>

            {/* ── database ── */}
            <Card variant="classic" padding={cardPad} title="Postgres">
              <KV rows={[
                ["Status", h.db.ok ? "up" : `down — ${h.db.error ?? ""}`],
                ["Round trip", `${h.db.latencyMs} ms`],
                ["Pool", h.db.pool ? `${h.db.pool.total} open · ${h.db.pool.idle} idle · ${h.db.pool.waiting} waiting · max ${h.db.pool.max ?? "?"}` : "—"],
                ["Connections", num(h.db.connections)],
                ["Database size", h.db.sizeMb != null ? `${(h.db.sizeMb / 1024).toFixed(2)} GB` : "—"],
              ]} />
            </Card>

            {/* ── vela ── */}
            <Card variant="classic" padding={cardPad} title="Vela" subtitle="Usage from vela_events · D/W/M history and the chains cache">
              <KV rows={[
                ["On now", `${num(h.vela.usage.sessions15m)} sessions (15 min)`],
                ["Last 24h", `${num(h.vela.usage.people24h)} people · ${num(h.vela.usage.events1h)} events last hour`],
                ["Last event", `${dur(h.vela.usage.newestEventAgeSec)} ago`],
                ["History", h.vela.history?.error ? String(h.vela.history.error) : `${num(h.vela.history?.entries)} cached · ${num(h.vela.history?.fresh)} fresh · ${num(h.vela.history?.inflight)} in flight`],
                ["History fails", h.vela.history?.lastFail ? `${num(h.vela.history?.fails)} · last ${dur(h.vela.history?.lastFailAgeSec as number)} ago: ${String(h.vela.history.lastFail)}` : num(h.vela.history?.fails)],
                ["Chains", h.vela.chains?.error ? String(h.vela.chains.error) : `${num(h.vela.chains?.keys)} keys · oldest ${dur(h.vela.chains?.oldestAgeSec as number)} · ${num(h.vela.chains?.refreshing)} refreshing`],
                ["Chain pulls", `${num(h.vela.chains?.pulls)} · ${num(h.vela.chains?.fails)} failed${h.vela.chains?.lastFailStatus ? ` · last HTTP ${String(h.vela.chains.lastFailStatus)}` : ""}`],
              ]} />
            </Card>

            {/* ── lse + env ── */}
            <Card variant="classic" padding={cardPad} title="LSE vault · env" subtitle="Budget counts only · env flags that live only in .env.local">
              <KV rows={[
                ...(h.probes.lse && !h.probes.lse.error ? ([
                  ["LSE key", h.probes.lse.configured ? `${num(h.probes.lse.keys)} configured` : "not set"],
                  ["Budget today", `${num(h.probes.lse.used)} / ${num(h.probes.lse.limit)} · ${num(h.probes.lse.refused)} refused`],
                  ["Keys out", num(h.probes.lse.exhaustedKeys)],
                  ["In flight", `${num(h.probes.lse.inflight)} · ${num(h.probes.lse.queued)} queued`],
                  ["Tape stream", String((h.probes.lse.tape as { mode?: string } | undefined)?.mode ?? "off")],
                ] as [string, ReactNode][]) : ([["LSE", h.probes.lse?.error ? String(h.probes.lse.error) : "not loaded"]] as [string, ReactNode][])),
                ...Object.entries(h.env).map(([k, v]) => [k, v === null ? "unset" : typeof v === "boolean" ? (v ? "set" : "unset") : String(v)] as [string, ReactNode]),
              ]} />
            </Card>
          </div>

          {showRaw && (
            <Card variant="classic" padding={cardPad} title="Raw" subtitle="GET /api/healthz — also at cbedge.net/healthz">
              <pre style={{ ...mono, margin: 0, fontSize: 12, color: T.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 520, overflow: "auto" }}>
                {JSON.stringify(h, null, 2)}
              </pre>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
