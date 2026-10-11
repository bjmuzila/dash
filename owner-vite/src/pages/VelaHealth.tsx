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
  activity?: Activity;
}
interface ActivityItem {
  at: string; kind: "deploy" | "deploy-failed" | "rollback" | "nightly" | "nightly-missed" | "lib-check" | "restart";
  level: Level; title: string; detail?: string | null; note?: string | null;
}
interface Activity { items?: ActivityItem[]; error?: string; sources?: Record<string, string> }
interface Ready { ok: boolean; rth: boolean; reasons: string[]; dbMs: number | null; feed: { spotAgeSec: number | null; feedAgeSec: number | null } | null }

/** /api/hetzner-metrics and /api/cloudflare-metrics — the same two routes Admin's
 *  hosting strip reads (components/SystemHealth.tsx). Only the egress halves are
 *  used here. */
interface HostSeries { value: number | null; unit: string; window: string; spark?: number[] }
interface HetznerMetrics { ok?: boolean; bandwidth: HostSeries; fetchedAt: string; unconfigured?: boolean }
interface CfMetrics { ok?: boolean; egress: HostSeries; fetchedAt: string; unconfigured?: boolean }

const POLL_MS = 30_000;
const STRIP_MAX = 60;
const SERIES_MAX = 30;

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

// ── bar cards (uptime / last tick / egress) ──

const fmtMb = (v: number) => (v < 1024 ? `${v.toFixed(1)} MB` : v < 1024 * 1024 ? `${(v / 1024).toFixed(2)} GB` : `${(v / 1024 / 1024).toFixed(2)} TB`);

/** Fold a long sample array into at most `n` bars (mean per bucket) so a 30d
 *  series and a 1h series draw the same bar width. */
function bucket(data: number[], n = SERIES_MAX): number[] {
  if (data.length <= n) return data;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * data.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * data.length) / n));
    const slice = data.slice(a, b);
    out.push(slice.reduce((s, v) => s + v, 0) / slice.length);
  }
  return out;
}

/** Newest bar vs the mean of the bars before it. First-vs-last of a spiky
 *  series swings wildly on whichever two samples land at the ends; against the
 *  window's own average it says "is right now unusual". */
function barDelta(data: number[]): number | null {
  if (data.length < 3) return null;
  const prior = data.slice(0, -1);
  const mean = prior.reduce((s, v) => s + v, 0) / prior.length;
  if (!Number.isFinite(mean) || mean === 0) return null;
  return ((data[data.length - 1] - mean) / Math.abs(mean)) * 100;
}

/** The delta chip. Fixed 18px box, 4px corners, mono tabular digits so the width
 *  doesn't jitter between polls, and an SVG arrow (not a text glyph) so it sits
 *  dead-centre. `invert` = up is bad (lag, egress). `text` = neutral chip, no
 *  good/bad read. */
function DeltaPill({ delta, invert = false, text, title, color: textColor }: { delta?: number | null; invert?: boolean; text?: string; title?: string; color?: string }) {
  let color: string = textColor ?? T.cyan;
  let dir: "up" | "down" | "flat" | null = null;
  let label = text ?? "";
  if (text == null) {
    if (delta == null || !Number.isFinite(delta)) return null;
    const mag = Math.abs(delta);
    dir = mag < 0.05 ? "flat" : delta > 0 ? "up" : "down";
    const good = invert ? delta < 0 : delta > 0;
    color = dir === "flat" ? T.cyan : good ? T.green : T.red;
    label = mag >= 1000 ? `${(mag / 1000).toFixed(1)}K%` : `${mag.toFixed(1)}%`;
  }
  return (
    <span
      title={title}
      style={{
        ...mono, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, flex: "0 0 auto",
        height: 18, padding: "0 6px", boxSizing: "border-box", borderRadius: 4,
        fontSize: 11, fontWeight: 700, lineHeight: 1, letterSpacing: 0, whiteSpace: "nowrap",
        color, background: ownerRgba(color, 0.12), border: `1px solid ${ownerRgba(color, 0.4)}`,
      }}
    >
      {dir && dir !== "flat" && (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden style={{ display: "block", transform: dir === "down" ? "rotate(180deg)" : undefined }}>
          <path d="M4 0.5 L7.5 4.5 H5 V7.5 H3 V4.5 H0.5 Z" fill="currentColor" />
        </svg>
      )}
      {dir === "flat" && (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden style={{ display: "block" }}>
          <path d="M0.5 3 H7.5 V5 H0.5 Z" fill="currentColor" />
        </svg>
      )}
      <span>{label}</span>
    </span>
  );
}

function Bars({ data, color, fmt }: { data: number[]; color: string; fmt: (v: number) => string }) {
  const max = Math.max(0, ...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 46, borderBottom: `1px solid ${T.border}`, marginTop: 4 }}>
      {data.length < 2 && <span style={{ fontSize: 12, color: T.cyan, alignSelf: "center" }}>collecting…</span>}
      {data.length >= 2 && data.map((v, i) => (
        <span
          key={i}
          title={fmt(v)}
          style={{
            flex: "1 1 0", minWidth: 1, borderRadius: "2px 2px 0 0",
            height: `${max > 0 ? Math.max(4, (v / max) * 100) : 4}%`,
            background: color, opacity: i === data.length - 1 ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

function BarCard({ level, name, value, sub, pill, data, color, fmt, compact }: {
  level: Level; name: string; value: string; sub: string; pill: ReactNode; data: number[]; color: string; fmt: (v: number) => string; compact?: boolean;
}) {
  return (
    <div style={{ background: T.panelInset, border: `1px solid ${level === "ok" ? T.border : ownerRgba(LEVEL_COLOR[level], 0.5)}`, borderRadius: 12, padding: compact ? "10px 11px" : "12px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 18 }}>
        <Dot level={level} />
        <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={name}>{name}</span>
        {!compact && pill}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4, minWidth: 0 }}>
        <span style={{ ...mono, fontSize: compact ? 16 : 20, fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>{value}</span>
        {compact && pill}
      </div>
      <span style={{ fontSize: 12, color: T.cyan, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sub}>{sub}</span>
      <Bars data={data} color={color} fmt={fmt} />
    </div>
  );
}

// ── detail panels: grouped, headline numbers first, the rest as meters and chips ──
//
// Brandon, 2026-10-10: the old six label/value cards were "just a bunch of
// numbers". Each panel now leads with the two or three numbers worth reading,
// shows ratios as meters (coverage, memory, heap, pool, LSE budget) and states
// as chips, and pushes the leftovers into one muted footer line.

const cardPad = 18;

/** A labelled group of panels — two across on desktop, stacked on mobile. */
function Section({ title, aside, cols = 2, children }: { title: string; aside?: ReactNode; cols?: number; children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "0 2px" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>{title}</span>
        {aside && <span style={{ fontSize: 12, color: T.cyan }}>{aside}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>{children}</div>
    </section>
  );
}

function Panel({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: T.panelBgStrong, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>{title}</span>
          {subtitle && <span style={{ fontSize: 12, color: T.cyan, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={subtitle}>{subtitle}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** The two or three numbers a panel is about. */
function Hero({ items }: { items: { v: string; l: string; level?: Level }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px" }}>
      {items.map((x) => (
        <div key={x.l} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ ...mono, fontSize: 20, fontWeight: 700, lineHeight: 1.1, color: x.level && x.level !== "ok" ? LEVEL_COLOR[x.level] : T.text, whiteSpace: "nowrap" }}>{x.v}</span>
          <span style={{ fontSize: 12, color: T.green }}>{x.l}</span>
        </div>
      ))}
    </div>
  );
}

/** A labelled ratio bar. `frac` is 0–1; `marker` draws a tick (e.g. peak). */
function Meter({ label, frac, right, color = T.cyan, marker }: { label: string; frac: number | null; right: string; color?: string; marker?: number }) {
  const w = frac == null || !Number.isFinite(frac) ? 0 : Math.max(0, Math.min(1, frac));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr) auto", gap: 10, alignItems: "center", fontSize: 12 }}>
      <span style={{ color: T.green, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ position: "relative", height: 6, borderRadius: 3, background: ownerRgba("#FFFFFF", 0.07) }}>
        <span style={{ position: "absolute", inset: 0, width: `${w * 100}%`, minWidth: w > 0 ? 3 : 0, borderRadius: 3, background: color }} />
        {marker != null && Number.isFinite(marker) && (
          <span aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${Math.max(0, Math.min(1, marker)) * 100}% - 1px)`, width: 2, borderRadius: 1, background: T.orange }} />
        )}
      </span>
      <span style={{ ...mono, color: T.text, textAlign: "right", whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
}

/** A state as a small dot + label. "off" = deliberately not on, no alarm. */
function Chip({ level, children, title }: { level?: Level | "off"; children: ReactNode; title?: string }) {
  return (
    <span title={title} style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 6, height: 22, padding: "0 8px", boxSizing: "border-box", borderRadius: 5, fontSize: 12, color: T.text, whiteSpace: "nowrap", border: `1px solid ${level && level !== "ok" && level !== "off" ? ownerRgba(LEVEL_COLOR[level], 0.45) : T.border}`, background: ownerRgba("#FFFFFF", 0.03) }}>
      {level && <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flex: "0 0 auto", background: level === "off" ? ownerRgba("#FFFFFF", 0.28) : LEVEL_COLOR[level] }} />}
      {children}
    </span>
  );
}
const Chips = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>;
const Foot = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 12, color: T.cyan, overflowWrap: "anywhere" }}>{children}</div>;

/** The Postgres pool as one block per connection slot. */
function PoolBlocks({ busy, idle, max }: { busy: number; idle: number; max: number }) {
  const n = Math.max(1, Math.min(40, max));
  return (
    <div style={{ display: "flex", gap: 3 }} aria-label={`${busy} busy, ${idle} idle of ${max}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} style={{ flex: "1 1 0", height: 14, borderRadius: 3, background: i < busy ? T.cyan : i < busy + idle ? ownerRgba(T.cyan, 0.3) : ownerRgba("#FFFFFF", 0.07) }} />
      ))}
    </div>
  );
}

// ── activity feed ──

const ACT_ICON: Record<ActivityItem["kind"], { glyph: string; color: string }> = {
  deploy: { glyph: "↑", color: T.orange },
  "deploy-failed": { glyph: "✕", color: T.red },
  rollback: { glyph: "↺", color: T.gold },
  nightly: { glyph: "↻", color: T.green },
  "nightly-missed": { glyph: "!", color: T.red },
  "lib-check": { glyph: "✓", color: T.green },
  restart: { glyph: "↻", color: T.gold },
};

function dayLabel(ms: number): string {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function ActivityFeed({ activity }: { activity?: Activity }) {
  const [all, setAll] = useState(false);
  const isMobile = useIsMobile();
  const items = activity?.items ?? [];
  const cutoff = Date.now() - 3 * 86_400_000;
  const shown = all ? items : items.filter((i) => Date.parse(i.at) >= cutoff);
  const groups: { label: string; rows: ActivityItem[] }[] = [];
  for (const it of shown) {
    const label = dayLabel(Date.parse(it.at));
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(it); else groups.push({ label, rows: [it] });
  }
  const src = activity?.sources;
  const missing = src ? Object.entries(src).filter(([, v]) => v !== "ok").map(([k, v]) => `${k} ${v}`) : [];
  return (
    <Panel
      title="Activity"
      subtitle="pushes · 2 AM restart · Vela library check"
      right={items.length > shown.length || all ? (
        <button type="button" onClick={() => setAll((v) => !v)} style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 12 }}>{all ? "Last 3 days" : "Show 7 days"}</button>
      ) : undefined}
    >
      {activity?.error && <Foot>{activity.error === "not-loaded" ? "server-v2/activity.cjs is not on the running server yet." : activity.error}</Foot>}
      {!activity?.error && shown.length === 0 && <Foot>Nothing recorded yet. Entries start with the next deploy, the 2 AM restart and the 7:59 AM library check.</Foot>}
      {groups.map((g) => (
        <div key={g.label} style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.green, padding: "2px 0 4px" }}>{g.label}</span>
          {g.rows.map((it, i) => {
            const ic = it.level === "ok" ? ACT_ICON[it.kind] : { ...ACT_ICON[it.kind], color: LEVEL_COLOR[it.level] };
            const pill = it.kind === "deploy" ? (it.detail?.replace("live in ", "") || "live") : it.level === "ok" ? "ok" : it.kind === "lib-check" ? "update" : it.level === "down" ? (it.kind === "nightly-missed" ? "missed" : "failed") : "check";
            const pc = it.kind === "deploy" ? T.cyan : it.level === "ok" ? T.green : LEVEL_COLOR[it.level];
            return (
              <div key={`${it.at}-${i}`} style={{ display: "grid", gridTemplateColumns: isMobile ? "22px minmax(0, 1fr) auto" : "22px 76px minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "7px 0", borderTop: i ? `1px solid ${ownerRgba("#FFFFFF", 0.05)}` : "none" }}>
                <span aria-hidden style={{ width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, lineHeight: 1, color: ic.color, background: ownerRgba(ic.color, 0.14) }}>{ic.glyph}</span>
                {!isMobile && <span style={{ ...mono, fontSize: 12, color: T.cyan, whiteSpace: "nowrap" }}>{new Date(it.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                <span style={{ minWidth: 0, fontSize: 13, lineHeight: 1.35 }}>
                  {isMobile && <span style={{ ...mono, display: "block", fontSize: 11, color: T.cyan }}>{new Date(it.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                  <span style={{ ...(it.kind.startsWith("deploy") ? mono : {}), color: T.text, fontWeight: it.kind.startsWith("deploy") ? 700 : 500 }}>{it.title}</span>
                  {it.kind.startsWith("deploy") ? (
                    it.note ? <span style={{ color: T.green }}> · {it.note}</span> : <span style={{ color: T.cyan }}> · no note</span>
                  ) : it.detail ? <span style={{ color: T.green }}> · {it.detail}</span> : null}
                  {it.kind === "deploy-failed" && it.detail && <span style={{ color: T.cyan }}> · {it.detail}</span>}
                </span>
                <DeltaPill text={pill} color={pc} />
              </div>
            );
          })}
        </div>
      ))}
      {missing.length > 0 && <Foot>Not reporting: {missing.join(" · ")}</Foot>}
    </Panel>
  );
}

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
  // This tab's per-poll samples for the two cards that only report "right now".
  const [uptimeSeries, setUptimeSeries] = useState<number[]>([]);
  const [tickSeries, setTickSeries] = useState<number[]>([]);
  const [hetzner, setHetzner] = useState<HetznerMetrics | null>(null);
  const [cf, setCf] = useState<CfMetrics | null>(null);
  const inflight = useRef(false);
  const isMobile = useIsMobile();

  const load = useCallback(async (fresh = false) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const [hr, rr, hz, cfr] = await Promise.all([
        fetch(`/api/healthz${fresh ? "?fresh=1" : ""}`, { cache: "no-store", credentials: "include" }),
        fetch("/api/healthz/ready", { cache: "no-store", credentials: "include" }).catch(() => null),
        fetch("/api/hetzner-metrics?window=live", { cache: "no-store", credentials: "include" }).catch(() => null),
        fetch("/api/cloudflare-metrics?window=live", { cache: "no-store", credentials: "include" }).catch(() => null),
      ]);
      // Hosting numbers: merge-don't-blank, same as Admin — a flaky upstream poll
      // holds the last good reading instead of wiping the card.
      if (hz?.ok) {
        const next = (await hz.json().catch(() => null)) as HetznerMetrics | null;
        if (next?.bandwidth) setHetzner((p) => ({
          ...next,
          bandwidth: { ...next.bandwidth, value: next.bandwidth.value ?? p?.bandwidth.value ?? null, spark: next.bandwidth.spark?.length ? next.bandwidth.spark : p?.bandwidth.spark },
        }));
      }
      if (cfr?.ok) {
        const next = (await cfr.json().catch(() => null)) as CfMetrics | null;
        if (next?.egress) setCf((p) => ({
          ...next,
          egress: { ...next.egress, value: next.egress.value ?? p?.egress.value ?? null, spark: next.egress.spark?.length ? next.egress.spark : p?.egress.spark },
        }));
      }
      const body = (await hr.json().catch(() => null)) as (Health & { error?: string }) | null;
      if (!hr.ok || !body || body.error) {
        // A 404 with an HTML body is the Next fallthrough: the running build predates /api/healthz.
        throw new Error(hr.status === 404 ? "/api/healthz is not on the running server yet — deploy server-v2." : body?.error || `HTTP ${hr.status}`);
      }
      setH(body);
      setErr(null);
      if (Number.isFinite(body.process?.uptimeSec)) setUptimeSeries((s) => [...s, body.process.uptimeSec].slice(-SERIES_MAX));
      if (body.feed?.lastFeedAgeSec != null && Number.isFinite(body.feed.lastFeedAgeSec)) setTickSeries((s) => [...s, body.feed.lastFeedAgeSec as number].slice(-SERIES_MAX));
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

  // ── the four bar cards (Admin's server + hosting numbers, renamed by source) ──
  // uptime and tick age were measured at heldAt; count them forward between polls.
  const sinceHeld = h ? Math.max(0, (now - h.heldAt) / 1000) : 0;
  const uptimeNow = h?.process?.uptimeSec != null ? h.process.uptimeSec + sinceHeld : null;
  const tickNow = h?.feed?.lastFeedAgeSec != null ? h.feed.lastFeedAgeSec + sinceHeld : null;
  const tickLevel: Level = tickNow == null ? "warn" : !h?.rth ? "ok" : tickNow > 60 ? "down" : tickNow > 10 ? "warn" : "ok";
  const cfBars = bucket(cf?.egress.spark ?? []);
  const hzBars = bucket(hetzner?.bandwidth.spark ?? []);
  const barCards = h ? [
    {
      level: (uptimeNow != null && uptimeNow < 300 ? "warn" : "ok") as Level,
      name: "Node uptime",
      value: dur(uptimeNow),
      sub: "server-v2 process · per poll",
      pill: <DeltaPill text={`boot ${clock(h.process?.startedAt).slice(0, 5)}`} title={`Process started ${h.process?.startedAt ? new Date(h.process.startedAt).toLocaleString() : "—"}`} />,
      data: uptimeSeries, color: T.lightBlue, fmt: (v: number) => dur(v),
    },
    {
      level: tickLevel,
      name: "dxLink last tick",
      value: tickNow != null ? `${Math.round(tickNow)}s` : "—",
      sub: `TT feed lag${h.rth ? "" : " · market closed"}`,
      pill: <DeltaPill delta={barDelta(tickSeries)} invert title="Newest poll vs the average of this tab's earlier polls · up = feed falling behind" />,
      data: tickSeries, color: tickLevel === "ok" ? T.green : LEVEL_COLOR[tickLevel], fmt: (v: number) => `${Math.round(v)}s`,
    },
    {
      level: (cf?.unconfigured ? "warn" : "ok") as Level,
      name: "Cloudflare egress · 24h",
      value: cf?.egress.value != null ? fmtMb(cf.egress.value) : cf?.unconfigured ? "Setup" : "—",
      sub: cf?.unconfigured ? "needs CLOUDFLARE_API_TOKEN" : "edge bandwidth served",
      pill: <DeltaPill delta={barDelta(cfBars)} invert title="Newest bar vs the 24h average · up = more bandwidth than usual" />,
      data: cfBars, color: T.orange, fmt: fmtMb,
    },
    {
      level: (hetzner?.unconfigured ? "warn" : "ok") as Level,
      name: "Hetzner egress · 1h",
      value: hetzner?.bandwidth.value != null ? fmtMb(hetzner.bandwidth.value) : hetzner?.unconfigured ? "Setup" : "—",
      sub: hetzner?.unconfigured ? "needs HETZNER_API_TOKEN" : "VPS network out",
      pill: <DeltaPill delta={barDelta(hzBars)} invert title="Newest bar vs the 1h average · up = more bandwidth than usual" />,
      data: hzBars, color: T.cyan, fmt: fmtMb,
    },
  ] : [];

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
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: isMobile ? 8 : 12 }}>
            {barCards.map((c) => <BarCard key={c.name} {...c} compact={isMobile} />)}
            {mons.map((m) => <Monitor key={m.name} {...m} compact={isMobile} />)}
          </div>

          {/* ── activity: pushes, the 2 AM restart, the Vela library check ── */}
          <ActivityFeed activity={h.activity} />

          {/* ── market data ── */}
          <Section title="Market data">
            <Panel title="Feed" subtitle="TastyTrade → dxLink" right={h.feed.error ? <Chip level="down">unreachable</Chip> : undefined}>
              {h.feed.error ? <Foot>{h.feed.error}</Foot> : (() => {
                const f = h.feed;
                const tickAge = f.lastFeedAgeSec;
                const tickLvl: Level = tickAge == null ? "warn" : !h.rth ? "ok" : tickAge > 90 ? "down" : tickAge > 10 ? "warn" : "ok";
                const cov = (p: number | null | undefined) => (p == null ? null : p / 100);
                const covColor = (p: number | null | undefined) => (p == null ? T.cyan : p >= 90 ? T.green : p > 0 ? T.gold : h.rth ? T.red : T.gold);
                return (
                  <>
                    <Chips>
                      <Chip level={f.ttAuthenticated ? "ok" : "down"}>TT auth</Chip>
                      <Chip level={f.dxlinkConnected ? "ok" : "down"}>dxLink</Chip>
                      <Chip level={f.chartReady ? "ok" : "warn"}>chart ready</Chip>
                      <Chip level={f.idle ? (h.rth ? "down" : "warn") : "off"}>{f.idle ? "idle ON" : "idle off"}</Chip>
                    </Chips>
                    <Hero items={[
                      { v: num(f.contractsSubscribed), l: "contracts" },
                      { v: f.spot != null ? f.spot.toFixed(2) : "—", l: `spot · ${dur(f.spotAgeSec)} old` },
                      { v: dur(tickAge), l: "since last tick", level: tickLvl },
                    ]} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <Meter label="OI coverage" frac={cov(f.oiCoveragePct)} right={f.oiCoveragePct != null ? `${f.oiCoveragePct}%` : "—"} color={covColor(f.oiCoveragePct)} />
                      <Meter label="Greeks" frac={cov(f.greeksCoveragePct)} right={f.greeksCoveragePct != null ? `${f.greeksCoveragePct}%` : "—"} color={covColor(f.greeksCoveragePct)} />
                    </div>
                    <Foot>Last error: {f.lastError || "none"}{h.rth ? "" : " · market closed"}</Foot>
                  </>
                );
              })()}
            </Panel>

            <Panel title="/ws/gex" subtitle="trailing 60s · the bandwidth alarm's numbers">
              {h.socket.error ? <Foot>{h.socket.error}</Foot> : (
                <>
                  <Hero items={[
                    { v: num(h.socket.clients), l: "clients" },
                    { v: `${h.socket.mbPerMin ?? 0}`, l: "MB / min" },
                    { v: `${h.socket.projectedGbPerDay ?? 0}`, l: "GB / day pace" },
                  ]} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(h.socket.top ?? []).length === 0 && <Foot>No frames sent in the last minute.</Foot>}
                    {(h.socket.top ?? []).map((t) => (
                      <Meter key={t.type} label={t.type} frac={t.pct / 100} right={`${t.kb.toLocaleString()} KB`} />
                    ))}
                  </div>
                  <Foot>{num(h.socket.connectsLastMin)} connects last min · {num(h.socket.totalConnects)} since boot · snapshots {num(h.socket.snapshotPct)}% of egress</Foot>
                </>
              )}
            </Panel>
          </Section>

          {/* ── server ── */}
          <Section title="Server">
            <Panel title="Process" subtitle={`node ${h.process.node} · up since ${clock(h.process.startedAt)}`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Meter label="Memory" frac={h.process.peakRssMb ? h.process.rssMb / h.process.peakRssMb : null} right={`${h.process.rssMb} / peak ${h.process.peakRssMb} MB`} color={h.process.rssMb >= 3072 ? T.gold : T.cyan} />
                <Meter label="Heap" frac={h.process.heapTotalMb ? h.process.heapMb / h.process.heapTotalMb : null} right={`${h.process.heapMb} / ${h.process.heapTotalMb} MB`} />
                <Meter
                  label="Loop delay" frac={Math.min(1, h.process.loop.p99Ms / 100)} marker={Math.min(1, h.process.loop.maxMs / 100)}
                  right={`p99 ${h.process.loop.p99Ms} · max ${h.process.loop.maxMs} ms`}
                  color={h.process.loop.maxMs >= 1000 ? T.gold : T.green}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, color: T.green }}>
                  Stalls over 250 ms · {h.process.loop.stalls} since boot{h.process.loop.stalls ? ` · worst ${h.process.loop.worstStallMs >= 1000 ? `${(h.process.loop.worstStallMs / 1000).toFixed(1)} s` : `${h.process.loop.worstStallMs} ms`}` : ""}
                </span>
                {h.process.loop.recentStalls.length > 0 ? (
                  <Bars data={h.process.loop.recentStalls.map((s) => s.ms)} color={h.process.loop.recentStalls.some((s) => s.ms >= 1000) ? T.gold : T.cyan} fmt={(v) => `${Math.round(v)} ms`} />
                ) : <Foot>None since boot.</Foot>}
                {h.process.loop.recentStalls.length > 0 && (
                  <Foot>Last at {clock(h.process.loop.recentStalls[h.process.loop.recentStalls.length - 1].at)}. Hover a bar for its length.</Foot>
                )}
              </div>
            </Panel>

            <Panel title="Postgres" right={<Chip level={h.db.ok ? (h.db.latencyMs > 500 ? "warn" : "ok") : "down"}>{h.db.ok ? "up" : "down"}</Chip>}>
              {!h.db.ok ? <Foot>{h.db.error ?? "no answer"}</Foot> : (
                <>
                  <Hero items={[
                    { v: `${h.db.latencyMs} ms`, l: "round trip", level: h.db.latencyMs > 500 ? "warn" : undefined },
                    { v: num(h.db.connections), l: "connections" },
                    { v: h.db.sizeMb != null ? `${(h.db.sizeMb / 1024).toFixed(1)} GB` : "—", l: "database" },
                  ]} />
                  {h.db.pool && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 12, color: T.green }}>
                        Pool · {h.db.pool.total - h.db.pool.idle} busy · {h.db.pool.idle} idle · {h.db.pool.waiting} waiting{h.db.pool.max != null ? ` · max ${h.db.pool.max}` : ""}
                      </span>
                      <PoolBlocks busy={h.db.pool.total - h.db.pool.idle} idle={h.db.pool.idle} max={h.db.pool.max ?? h.db.pool.total} />
                    </div>
                  )}
                </>
              )}
            </Panel>
          </Section>

          {/* ── vela + config ── */}
          <Section title="Vela and config">
            <Panel title="Vela" subtitle="vela_events · caches">
              {h.vela.usage.error ? <Foot>{h.vela.usage.error}</Foot> : (
                <Hero items={[
                  { v: num(h.vela.usage.sessions15m), l: "on now" },
                  { v: num(h.vela.usage.people24h), l: "people 24h" },
                  { v: num(h.vela.usage.events1h), l: "events 1h" },
                ]} />
              )}
              <Chips>
                {h.vela.chains?.error ? <Chip level="warn">chains {String(h.vela.chains.error)}</Chip> : (
                  <Chip level={Number(h.vela.chains?.failing) > 0 ? "warn" : "ok"} title={`oldest ${dur(h.vela.chains?.oldestAgeSec as number)} · ${num(h.vela.chains?.refreshing)} refreshing`}>
                    chains {num(h.vela.chains?.keys)} keys · {num(h.vela.chains?.pulls)} pulls · {num(h.vela.chains?.fails)} failed
                  </Chip>
                )}
                {h.vela.history?.error ? <Chip level="warn">history {String(h.vela.history.error)}</Chip> : (
                  <Chip level={Number(h.vela.history?.entries) ? (Number(h.vela.history?.fails) ? "warn" : "ok") : "off"} title={h.vela.history?.lastFail ? `last fail: ${String(h.vela.history.lastFail)}` : undefined}>
                    history {num(h.vela.history?.entries)} cached · {num(h.vela.history?.fails)} fails
                  </Chip>
                )}
                {!h.vela.usage.error && <Chip level="ok">last event {dur(h.vela.usage.newestEventAgeSec)} ago</Chip>}
              </Chips>
            </Panel>

            <Panel title="LSE vault" subtitle={h.probes.lse && !h.probes.lse.error ? `tape: ${String((h.probes.lse.tape as { mode?: string } | undefined)?.mode ?? "off")}` : undefined}>
              {h.probes.lse && !h.probes.lse.error ? (
                <>
                  <Meter
                    label="Budget today"
                    frac={Number(h.probes.lse.limit) ? Number(h.probes.lse.used) / Number(h.probes.lse.limit) : null}
                    right={`${num(h.probes.lse.used)} / ${Number(h.probes.lse.limit) >= 1000 ? `${Math.round(Number(h.probes.lse.limit) / 1000)}k` : num(h.probes.lse.limit)}`}
                    color={Number(h.probes.lse.limit) && Number(h.probes.lse.used) / Number(h.probes.lse.limit) > 0.8 ? T.gold : T.green}
                  />
                  <Foot>{num(h.probes.lse.keys)} keys · {num(h.probes.lse.exhaustedKeys)} out · {num(h.probes.lse.refused)} refused · {num(h.probes.lse.inflight)} in flight · {num(h.probes.lse.queued)} queued</Foot>
                </>
              ) : <Foot>LSE {h.probes.lse?.error ? String(h.probes.lse.error) : "not loaded"}</Foot>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: T.green }}>Env flags · only in .env.local on the box</span>
                <Chips>
                  {Object.entries(h.env).map(([k, v]) => {
                    const flagged = h.problems.some((p) => p.code === `env.${k}`);
                    if (typeof v === "boolean") return <Chip key={k} level={flagged ? "warn" : v ? "ok" : "off"}>{k.replace(/_REQUIRED$/, "")}</Chip>;
                    return <Chip key={k} level={flagged ? "warn" : undefined}>{k} {v === null ? "unset" : String(v)}</Chip>;
                  })}
                </Chips>
              </div>
            </Panel>
          </Section>

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
