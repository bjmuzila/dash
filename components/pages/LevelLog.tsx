"use client";

/**
 * /level-log — the wall / CORE level log, as its own page under Scanner.
 *
 * A customer-facing port of the "level log" panel that lives on the owner
 * Results → Walls tab (owner-vite/src/pages/Results.tsx). Same data, same
 * reading: levels are captured at 09:29 ET and then every 15 minutes to 16:00,
 * but only WRITTEN when they change, so the day summary carries the last value
 * forward per level type and `open` holds the 09:29 baseline. A wall_events row
 * is opened whenever spot trades into a live level and is classified four slots
 * later (reject / break / broke and consolidated / new wall / pin).
 *
 * Data: GET /proxy/walls[?date=&symbol=] (server-v2/walls-recorder.js).
 * Fetch-on-load + an explicit refresh — no polling, so an open tab never
 * hammers the recorder.
 *
 * Two views, switched by the WALLS / CORE pills:
 *   WALLS — call wall + put wall entries only.
 *   CORE  — CORE (cb) entries only.
 * The switch filters the ticker rail, the capture rail, the timeline, the copy
 * text and the PNG together, so what you export is exactly what you're reading.
 *
 * Snapshot: goes through lib/snapshot.ts like every other capture in the app
 * (scripts/audit-ui.mjs --strict fails the build on a second html2canvas call
 * site). `framed: true` expands the clone past the scroll window, so the PNG is
 * a real screenshot of the whole card — styling, badges and colors included —
 * not a re-render of the text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { HOME_THEME, LIGHT_BLUE, homeInputStyle, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { PageShell } from "@/components/shared/PageCard";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { captureAndCopy } from "@/lib/snapshot";

// ── theme aliases ────────────────────────────────────────────────────────────
// Sourced from the shared palette so this page tracks the app (AGENTS.md: never
// hardcode hex). The owner page's "gold" maps to HOME_THEME.orange here.
const C = {
  cyan: HOME_THEME.cyan,
  border: HOME_THEME.border,
  label: HOME_THEME.text,
};
const GREEN = HOME_THEME.green;
const RED = HOME_THEME.red;
const AMBER = HOME_THEME.orange;
const MUTED = HOME_THEME.muted;
const CARD = classicCardAccentStyle;

function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Today's ET date as "YYYY-MM-DD". */
function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// ── types (mirror /proxy/walls) ──────────────────────────────────────────────
type WallLevel = "call_wall" | "put_wall" | "cb";
type WallReaction =
  | "reject" | "break_lt5" | "break_5" | "consolidated" | "new_wall" | "pin"
  | "rolled_over" | "reached" | "stalled";

type WallTicker = {
  symbol: string;
  spot: number | null;
  call_wall: number | null; put_wall: number | null; cb: number | null;
  open: Partial<Record<WallLevel, number>>;
  changes: number;
  hits: number;
  reclaim_min: number | null;
  reaction: WallReaction | null;
  last_event: string | null;
  rank?: number | null;
};

type WallLogRow = {
  slot: number; at: string; ts: string; level_type: WallLevel;
  strike: number; prev_strike: number | null; delta: number | null;
  spot: number; reason: "open" | "change";
  level_gex: number | null;
};

type WallEventRow = {
  hit_slot: number; at: string; hit_ts: string; level_type: WallLevel;
  strike: number; spot_at_hit: number; reaction: WallReaction | null;
  excursion_pts: number | null; reclaim_min: number | null;
  note: string | null; resolved_ts: string | null;
  kind: "touch" | "approach";
  was_core: boolean | null; core_held: boolean | null;
  gex_at_hit: number | null; gex_at_resolve: number | null;
  attempts: number;
};

// ── the view switch ──────────────────────────────────────────────────────────
/** WALLS = call wall + put wall. CORE = the CORE (cb) level on its own. */
type LogView = "walls" | "core";

const VIEW_LEVELS: Record<LogView, WallLevel[]> = {
  walls: ["call_wall", "put_wall"],
  core: ["cb"],
};
const VIEW_META: { id: LogView; label: string; color: string; blurb: string }[] = [
  { id: "walls", label: "Walls", color: AMBER, blurb: "Call wall + put wall only" },
  { id: "core", label: "Core", color: LIGHT_BLUE, blurb: "CORE level only" },
];
const inView = (v: LogView, lt: WallLevel) => VIEW_LEVELS[v].includes(lt);

const WALL_SLOTS = 27;
const LEVEL_LOG_H = 620;
const TICKER_COL_H = 620;

const LEVEL_LABEL: Record<WallLevel, string> = { call_wall: "Call Wall", put_wall: "Put Wall", cb: "CORE" };
const LEVEL_COLOR: Record<WallLevel, string> = { call_wall: AMBER, put_wall: GREEN, cb: LIGHT_BLUE };

const REACTION_LABEL: Record<WallReaction, string> = {
  reject: "Reject", break_lt5: "Break <5", break_5: "Break +5",
  consolidated: "Broke & consolidated", new_wall: "New wall", pin: "Pinned",
  rolled_over: "Rolled over", reached: "Approached, then tagged", stalled: "Stalled near",
};
const REACTION_COLOR: Record<WallReaction, string> = {
  reject: GREEN, break_lt5: AMBER, break_5: AMBER,
  consolidated: HOME_THEME.orange, new_wall: C.cyan, pin: LIGHT_BLUE,
  rolled_over: GREEN, reached: MUTED, stalled: MUTED,
};
/** How each reaction is decided — mirrors classify() in walls-recorder.js. */
const REACTION_RULE: Record<WallReaction, string> = {
  reject: "Tagged, never got past the touch band, faded ≥ 0.15% back inside",
  break_lt5: "Traded past the level but by less than the break threshold",
  break_5: "Max excursion ≥ 5 pts (0.15% for sub-$1000 names) past the level",
  consolidated: "Broke, then the last 3 samples all held outside inside a 0.10% range",
  new_wall: "Broke, and the level itself then rolled in the break direction",
  pin: "Sat inside the touch band for 3+ samples without resolving either way",
  rolled_over: "Came inside 0.30% without ever tagging, then reversed away — the level held at distance",
  reached: "Approached, then tagged the level after all",
  stalled: "Drifted near the level and neither tagged nor left",
};

/**
 * classify() files "broke by 8 then failed" as break_5 with reclaim_min set,
 * NOT as reject — deliberately, so the size label stays about distance. But on
 * the page that made a break that came straight back look identical to one that
 * held, which are opposite reads. Given reclaim_min, say so.
 */
function isBreakThenReject(ev?: { reaction: WallReaction | null; reclaim_min: number | null } | null): boolean {
  return !!ev && (ev.reaction === "break_5" || ev.reaction === "break_lt5") && ev.reclaim_min != null;
}

function wallBadgeStyle(color: string): CSSProperties {
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 13, fontWeight: 800,
    letterSpacing: "0.07em", textTransform: "uppercase", whiteSpace: "nowrap",
    color, background: rgba(color, 0.13), border: `1px solid ${rgba(color, 0.3)}`,
  };
}

function wallBadge(rx: WallReaction | null, short = false, reclaimMin: number | null = null): ReactNode {
  if (!rx) return <span style={{ ...wallBadgeStyle(MUTED), opacity: 0.55 }}>Untested</span>;
  if (isBreakThenReject({ reaction: rx, reclaim_min: reclaimMin })) {
    return (
      <span style={wallBadgeStyle(GREEN)} title={`Broke, then reclaimed after ${reclaimMin}m — failed break`}>
        {short ? "Brk→Rej" : `Break & reject (${reclaimMin}m)`}
      </span>
    );
  }
  const label = short && rx === "consolidated" ? "Consol." : REACTION_LABEL[rx];
  return <span style={wallBadgeStyle(REACTION_COLOR[rx])}>{label}</span>;
}

/** Compact signed GEX, e.g. "+1.2B" / "−340M". */
function gexShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v); const a = Math.abs(n); const sign = n < 0 ? "−" : "+";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

/** gex_at_hit → gex_at_resolve as a percentage build (or bleed). */
function gexBuildPct(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null;
  const a = Math.abs(Number(from));
  if (!(a > 0)) return null;
  return ((Math.abs(Number(to)) - a) / a) * 100;
}

const wallNum = (n: number | null | undefined, dp = 2) =>
  n == null || !Number.isFinite(Number(n)) ? "—"
    : Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Strikes print without forced decimals — 6890, not 6890.00. */
const wallStrike = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—"
    : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The level log as plain text, laid out for pasting into Discord or notes.
 * Built from the raw rows rather than scraped out of the rendered timeline, so
 * the copy carries the meta the eye skips. Ordering matches the screen: newest
 * first, and within one slot the hit leads the change that produced it.
 */
function buildLogText(
  symbol: string, spot: number | null, date: string, view: LogView,
  log: WallLogRow[], events: WallEventRow[],
): string {
  const L = (lt: WallLevel) => LEVEL_LABEL[lt];
  const out: string[] = [];
  const scope = view === "core" ? "CORE LOG" : "WALL LOG";
  out.push(`${symbol} — ${scope} · ${date}${spot != null ? ` · spot ${wallNum(spot)}` : ""}`);

  const opens = log.filter((r) => r.reason === "open");
  if (opens.length) {
    out.push("");
    out.push(`OPEN ${opens[0].at}`);
    for (const r of opens) out.push(`  ${L(r.level_type).padEnd(10)} ${wallStrike(r.strike)}`);
  }

  type Line = { slot: number; hit: boolean; text: string[] };
  const lines: Line[] = [];

  for (const r of log) {
    if (r.reason === "open") continue;
    const body = `${wallStrike(r.prev_strike)} → ${wallStrike(r.strike)}`;
    const t = [`${r.at}  ${L(r.level_type).padEnd(10)} ${"CHANGED".padEnd(22)} ${body}`];
    if (r.level_gex != null) t.push(`${" ".repeat(7)}GEX at level ${gexShort(r.level_gex)}`);
    lines.push({ slot: r.slot, hit: false, text: t });
  }

  for (const e of events) {
    const approach = e.kind === "approach";
    const verdict = e.reaction == null ? "WATCHING"
      : isBreakThenReject(e) ? `BREAK & REJECT (${e.reclaim_min}m)`
      : REACTION_LABEL[e.reaction].toUpperCase();
    const body = approach
      ? `near ${wallStrike(e.strike)} from ${wallNum(e.spot_at_hit)}, no tag`
      : `tagged ${wallStrike(e.strike)} at ${wallNum(e.spot_at_hit)}`;
    const t = [`${e.at}  ${L(e.level_type).padEnd(10)} ${verdict.padEnd(22)} ${body}`];

    const build = gexBuildPct(e.gex_at_hit, e.gex_at_resolve);
    const meta = [
      e.note,
      !approach && e.attempts > 1 ? `attempt ${e.attempts} on this strike` : null,
      e.was_core ? (e.core_held === false ? "was the CORE — CORE moved after" : "was the CORE") : null,
      e.gex_at_hit != null ? `GEX ${gexShort(e.gex_at_hit)}` : null,
      build != null ? `${build >= 0 ? "built" : "bled"} ${Math.abs(build).toFixed(0)}%` : null,
    ].filter(Boolean).join(" · ");
    if (meta) t.push(`${" ".repeat(7)}${meta}`);
    lines.push({ slot: e.hit_slot, hit: true, text: t });
  }

  lines.sort((a, b) => b.slot - a.slot || (a.hit === b.hit ? 0 : a.hit ? -1 : 1));
  if (lines.length) { out.push(""); for (const l of lines) out.push(...l.text); }
  else out.push("", "No changes or touches recorded.");
  return out.join("\n");
}

// ── buttons ──────────────────────────────────────────────────────────────────

/**
 * Screenshot the LIVE card.
 *
 * The owner version deliberately rendered `buildLogText()` into a throwaway
 * off-screen node, because a naive html2canvas() of the card grabbed only the
 * slice of the scroll window that happened to be in view and flattened the
 * frosted styling. lib/snapshot.ts fixes both — `framed: true` measures each
 * direct child by scrollHeight and expands the clone past the scroll container,
 * and the shared clone pass swaps backdrop-filter panels for their solid color.
 * So this captures the real UI, whole, and looks like the page.
 */
function SnapLogButton({ targetRef, filename, title, disabled }: {
  targetRef: RefObject<HTMLDivElement | null>;
  filename: string;
  title: string;
  disabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "saved" | "err">("idle");
  const go = useCallback(async () => {
    if (state === "working") return;
    const el = targetRef.current;
    if (!el) return;
    setState("working");
    try {
      setState(await captureAndCopy(el, filename, { framed: true, title }));
    } catch (e) {
      console.error("[level-log] snapshot", e);
      setState("err");
    }
    setTimeout(() => setState("idle"), 2200);
  }, [state, targetRef, filename, title]);

  const ok = state === "copied" || state === "saved";
  const color = ok ? GREEN : state === "err" ? RED : C.label;
  return (
    <button
      onClick={() => { void go(); }}
      disabled={disabled || state === "working"}
      title="Copy a PNG screenshot of this log to the clipboard"
      style={{
        padding: "5px 10px", borderRadius: 8, fontFamily: "inherit", fontSize: 13,
        fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
        cursor: disabled || state === "working" ? "default" : "pointer",
        opacity: disabled ? 0.3 : state === "working" ? 0.6 : 1,
        border: `1px solid ${ok ? color : C.border}`,
        background: ok ? rgba(color, 0.14) : "rgba(255,255,255,0.03)",
        color,
      }}
    >
      {state === "working" ? "Capturing…" : state === "copied" ? "✓ Copied"
        : state === "saved" ? "✓ Saved" : state === "err" ? "✕ Failed" : "📸 PNG"}
    </button>
  );
}

function CopyLogButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { /* clipboard blocked — leave the label alone rather than lying */ }
  }, [text]);
  return (
    <button
      onClick={() => { void copy(); }}
      disabled={disabled}
      title="Copy this log as formatted text"
      style={{
        padding: "5px 10px", borderRadius: 8, cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em",
        textTransform: "uppercase", opacity: disabled ? 0.3 : 1,
        border: `1px solid ${done ? GREEN : C.border}`,
        background: done ? rgba(GREEN, 0.14) : "rgba(255,255,255,0.03)",
        color: done ? GREEN : C.label,
      }}
    >
      {done ? "✓ Copied" : "⧉ Copy"}
    </button>
  );
}

function WallDelta({ now, open }: { now: number | null | undefined; open: number | undefined }) {
  if (now == null || open == null || now === open) return null;
  const up = now > open;
  const c = up ? GREEN : AMBER;
  return (
    <span style={{ fontSize: 13, fontWeight: 800, marginLeft: 6, padding: "1px 5px", borderRadius: 4, color: c, background: rgba(c, 0.12) }}>
      {up ? "▲" : "▼"}{wallStrike(Math.abs(now - open))}
    </span>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export default function LevelLog() {
  const [date, setDate] = useState(todayETStr());
  const [view, setView] = useState<LogView>("walls");
  const [tickers, setTickers] = useState<WallTicker[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ symbol: string; log: WallLogRow[]; events: WallEventRow[] } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Bumped by refresh. The day summary re-fetches through loadDay(); the
  // per-ticker detail lives in its own effect, so it needs a dep to poke.
  const [nonce, setNonce] = useState(0);

  const logCardRef = useRef<HTMLDivElement | null>(null);

  const loadDay = useCallback(async () => {
    setErr(null); setLoaded(false);
    try {
      const r = await fetch(`/proxy/walls?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const rows: WallTicker[] = Array.isArray(j.tickers) ? j.tickers : [];
      setTickers(rows);
      setSel((prev) => prev ?? rows[0]?.symbol ?? null);
    } catch (e) { setErr(String(e)); setTickers([]); }
    setLoaded(true);
  }, [date]);

  useEffect(() => { void loadDay(); }, [loadDay]);

  const refreshAll = useCallback(async () => {
    setNonce((n) => n + 1);
    await loadDay();
  }, [loadDay]);
  const { trigger: refresh, label: refreshLabel, style: refreshStyle } = useRefreshButton(refreshAll);

  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/proxy/walls?date=${encodeURIComponent(date)}&symbol=${encodeURIComponent(sel)}`, { cache: "no-store" });
        const j = await r.json();
        if (alive && j?.ok) setDetail({ symbol: j.symbol, log: j.log ?? [], events: j.events ?? [] });
      } catch { if (alive) setDetail(null); }
    })();
    return () => { alive = false; };
  }, [sel, date, nonce]);

  // ── the view switch, applied once ──────────────────────────────────────────
  // Everything downstream (rail, timeline, copy text, PNG) reads these, so the
  // WALLS / CORE pills can never disagree with what gets exported.
  const log = useMemo(
    () => (detail?.log ?? []).filter((r) => inView(view, r.level_type)),
    [detail, view],
  );
  const events = useMemo(
    () => (detail?.events ?? []).filter((e) => inView(view, e.level_type)),
    [detail, view],
  );

  const shown = useMemo(() => {
    const query = q.trim().toUpperCase();
    const rows = tickers.filter((t) => (query ? t.symbol.includes(query) : true));
    return [...rows].sort((a, b) => {
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.symbol.localeCompare(b.symbol);
    });
  }, [tickers, q]);

  const selRow = useMemo(() => tickers.find((t) => t.symbol === sel) ?? null, [tickers, sel]);
  const spot = selRow?.spot ?? null;

  const empty = !sel || !(log.length || events.length);
  const logText = useMemo(
    () => buildLogText(sel ?? "—", spot, date, view, log, events),
    [sel, spot, date, view, log, events],
  );
  const snapTitle = `${sel ?? "—"} — ${view === "core" ? "CORE" : "Wall"} log · ${date}`;
  const snapFile = `${(sel ?? "walls").toLowerCase()}-${view}-log-${date}.png`;

  const chipStyle = (on: boolean, color: string = C.cyan): CSSProperties => ({
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? color : C.border}`,
    background: on ? rgba(color, 0.16) : "rgba(255,255,255,0.03)",
    color: on ? color : C.label, fontSize: 13, fontWeight: 800,
    letterSpacing: "0.08em", textTransform: "uppercase",
  });

  const th: CSSProperties = {
    fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5,
    textAlign: "right", padding: "10px 9px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
    position: "sticky", top: 0, background: HOME_THEME.panelBgStrong,
  };
  const td: CSSProperties = {
    padding: "8px 9px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13,
    textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono)",
  };

  const viewMeta = VIEW_META.find((v) => v.id === view)!;

  return (
    <PageShell className="wall-scroll">
      {/* Control bar */}
      <div style={{ ...CARD, padding: "14px 18px", marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Level Log
        </span>
        <span style={{ fontSize: 13, color: C.label, opacity: 0.7 }}>
          {viewMeta.blurb} — 09:29 open + every 15m to 16:00 ET, change-only
        </span>

        {/* WALLS / CORE — the whole page is scoped by this. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 4 }}>
          {VIEW_META.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} style={chipStyle(view === v.id, v.color)} title={v.blurb}>
              {v.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date" value={date} onChange={(e) => { setDate(e.target.value); setSel(null); }}
            style={{ ...homeInputStyle, fontSize: 13, padding: "7px 10px", fontFamily: "inherit", colorScheme: "dark" }}
          />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter ticker…"
            style={{ ...homeInputStyle, fontSize: 13, padding: "7px 10px", minWidth: 140, fontFamily: "inherit" }}
          />
          <button onClick={() => { void refresh(); }} style={refreshStyle} title="Re-pull the day list and the selected ticker's level log">
            {refreshLabel}
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ ...CARD, padding: 18, marginBottom: 14, color: RED, fontSize: 13 }}>
          Could not load /proxy/walls — {err}
        </div>
      ) : null}

      {/* `minmax(0, 1fr) minmax(...)` is deliberate: globals.css's GLOBAL GRID
          COLLAPSE block matches that exact signature and stacks the two columns
          on a phone. A `340px` first track would have looked identical on a
          desktop and squeezed the log to nothing on mobile. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2.6fr)", gap: 16, alignItems: "start" }}>
        {/* Ticker rail — columns follow the view. */}
        <div style={{ ...CARD, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.75 }}>
              Tickers — {date}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.5 }}>
              {loaded ? `${shown.length}` : "…"}
            </span>
          </div>
          <div className="wall-scroll" style={{ maxHeight: TICKER_COL_H, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Ticker</th>
                  <th style={th}>Spot</th>
                  {view === "core" ? (
                    <th style={{ ...th, color: LEVEL_COLOR.cb, opacity: 0.85 }}>CORE</th>
                  ) : (
                    <>
                      <th style={{ ...th, color: LEVEL_COLOR.put_wall, opacity: 0.85 }}>Put</th>
                      <th style={{ ...th, color: LEVEL_COLOR.call_wall, opacity: 0.85 }}>Call</th>
                    </>
                  )}
                  <th style={th}>Chg</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr
                    key={t.symbol}
                    onClick={() => setSel(t.symbol)}
                    style={{
                      cursor: "pointer",
                      background: t.symbol === sel ? rgba(C.cyan, 0.1) : undefined,
                      boxShadow: t.symbol === sel ? `inset 2px 0 0 ${C.cyan}` : undefined,
                    }}
                  >
                    <td style={{ ...td, textAlign: "left", fontWeight: 800, letterSpacing: "0.03em" }}>{t.symbol}</td>
                    <td style={td}>{wallNum(t.spot)}</td>
                    {view === "core" ? (
                      <td style={{ ...td, color: LEVEL_COLOR.cb }}>{wallStrike(t.cb)}<WallDelta now={t.cb} open={t.open?.cb} /></td>
                    ) : (
                      <>
                        <td style={{ ...td, color: LEVEL_COLOR.put_wall }}>{wallStrike(t.put_wall)}<WallDelta now={t.put_wall} open={t.open?.put_wall} /></td>
                        <td style={{ ...td, color: LEVEL_COLOR.call_wall }}>{wallStrike(t.call_wall)}<WallDelta now={t.call_wall} open={t.open?.call_wall} /></td>
                      </>
                    )}
                    <td style={{ ...td, opacity: t.changes ? 1 : 0.35 }}>{t.changes}</td>
                  </tr>
                ))}
                {loaded && !shown.length ? (
                  <tr><td colSpan={view === "core" ? 4 : 5} style={{ ...td, textAlign: "center", padding: "34px 0", opacity: 0.5, fontFamily: "inherit" }}>
                    No rows for {date}. The recorder writes from 09:29 ET on trading days.
                  </td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* The level log itself — this whole card is what the PNG captures. */}
        <div ref={logCardRef} style={{ ...CARD, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.75 }}>
              {sel ?? "—"} — {view === "core" ? "core log" : "wall log"}
            </span>
            <span style={{ fontSize: 13, opacity: 0.7, fontFamily: "var(--font-mono)" }}>{wallNum(spot)}</span>
            {/* data-capture-hide: live-page chrome, dropped from the screenshot. */}
            <div data-capture-hide style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <CopyLogButton disabled={empty} text={logText} />
              <SnapLogButton disabled={empty} targetRef={logCardRef} filename={snapFile} title={snapTitle} />
            </div>
          </div>

          <WallCaptureRail log={log} events={events} />

          {/* Header + capture rail stay pinned; only the entries scroll. The
              snapshot expands past this (framed mode), so the PNG is the whole
              log rather than the visible slice. */}
          <div className="wall-scroll" style={{ maxHeight: LEVEL_LOG_H, overflowY: "auto" }}>
            <WallTimeline log={log} events={events} view={view} />
          </div>

          {/* Reaction legend — a hover-to-learn key for the badges above, not
              part of the log. `data-capture-hide` keeps it out of the PNG for
              two reasons: it is page chrome, and framed mode expands the scroll
              body WITHOUT reflowing the siblings below it, so the legend
              rendered on top of the timeline entries in the capture. */}
          <div data-capture-hide style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "14px 18px", borderTop: `1px solid ${C.border}` }}>
            {(Object.keys(REACTION_LABEL) as WallReaction[]).map((rx) => (
              <span key={rx} title={REACTION_RULE[rx]}>{wallBadge(rx)}</span>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

/** 27 squares — one per capture slot. Filled = a row was written at that slot. */
function WallCaptureRail({ log, events }: { log: WallLogRow[]; events: WallEventRow[] }) {
  const marks = new Array(WALL_SLOTS).fill("") as string[];
  for (const r of log) if (r.slot >= 0 && r.slot < WALL_SLOTS) marks[r.slot] = r.reason === "open" ? "open" : "change";
  for (const e of events) if (e.hit_slot >= 0 && e.hit_slot < WALL_SLOTS) marks[e.hit_slot] = "hit";
  const color = (m: string) => m === "hit" ? AMBER : m === "open" ? HOME_THEME.orange : m === "change" ? C.cyan : "rgba(255,255,255,0.09)";
  const filled = marks.filter(Boolean).length;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.45, marginRight: 8 }}>09:29</span>
      {marks.map((m, i) => (
        <span key={i} title={m ? `slot ${i}: ${m}` : `slot ${i}: no change`}
          style={{ width: 9, height: 9, borderRadius: 2, background: color(m), boxShadow: m ? `0 0 6px ${rgba(HOME_THEME.cyan, 0.35)}` : undefined }} />
      ))}
      <span style={{ fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.45, marginLeft: 8 }}>16:00</span>
      <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.45 }}>{log.length} rows · {WALL_SLOTS - filled} slots skipped</span>
    </div>
  );
}

/** Chronological merge of level changes and classified hits. */
function WallTimeline({ log, events, view }: { log: WallLogRow[]; events: WallEventRow[]; view: LogView }) {
  type Entry = { slot: number; at: string; kind: "open" | "change" | "hit"; lt: WallLevel; body: ReactNode; meta?: string };
  const entries: Entry[] = [];

  for (const r of log) {
    entries.push({
      slot: r.slot, at: r.at, kind: r.reason, lt: r.level_type,
      body: r.reason === "open"
        ? <>Open baseline — <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(r.strike)}</b>. Spot <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(r.spot)}</b>.</>
        : <>Rolled {Number(r.delta) > 0 ? "up" : "down"} <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(r.prev_strike)} → {wallStrike(r.strike)}</b>.</>,
      meta: r.level_gex != null ? `GEX at level ${gexShort(r.level_gex)}` : undefined,
    });
  }
  for (const e of events) {
    const approach = e.kind === "approach";
    const build = gexBuildPct(e.gex_at_hit, e.gex_at_resolve);
    entries.push({
      slot: e.hit_slot, at: e.at, kind: "hit", lt: e.level_type,
      body: approach
        ? <>Came within reach of <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b> from <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(e.spot_at_hit)}</b> without tagging{e.note ? ` — ${e.note}.` : "."}</>
        : <>Tagged <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b> at <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(e.spot_at_hit)}</b>{e.note ? ` — ${e.note}.` : "."}</>,
      meta: [
        !approach && e.excursion_pts != null ? `excursion ${Number(e.excursion_pts) > 0 ? "+" : ""}${wallNum(e.excursion_pts)}` : null,
        e.reclaim_min != null ? `reclaimed in ${e.reclaim_min}m` : null,
        !approach && e.attempts > 1 ? `attempt ${e.attempts} on this strike` : null,
        e.was_core ? (e.core_held === false ? "was the CORE — CORE moved after" : "was the CORE") : null,
        e.gex_at_hit != null ? `GEX at level ${gexShort(e.gex_at_hit)}` : null,
        build != null ? `${build >= 0 ? "built" : "bled"} ${Math.abs(build).toFixed(0)}% by resolve` : null,
        e.reaction == null ? "watching — resolves 4 slots after the tag" : null,
      ].filter(Boolean).join(" · "),
    });
  }

  // Newest first — the latest slot reads at the top. Within one slot the hit is
  // the later event, so it leads the change that produced it.
  const kindRank = (k: Entry["kind"]) => (k === "hit" ? 0 : 1);
  entries.sort((a, b) => b.slot - a.slot || kindRank(a.kind) - kindRank(b.kind));

  const evByKey = new Map(events.map((e) => [`${e.hit_slot}|${e.level_type}`, e]));

  if (!entries.length) {
    return (
      <div style={{ padding: "34px 18px", textAlign: "center", opacity: 0.45, fontSize: 13 }}>
        {view === "core"
          ? "Nothing recorded on the CORE for this ticker — no baseline, no level changes, no touches."
          : "Nothing recorded on the walls for this ticker — no baseline, no level changes, no touches."}
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 18px 18px" }}>
      {entries.map((e, i) => {
        const dot = e.kind === "hit" ? AMBER : e.kind === "open" ? HOME_THEME.orange : C.cyan;
        const ev = e.kind === "hit" ? evByKey.get(`${e.slot}|${e.lt}`) : null;
        return (
          <div key={`${e.slot}-${e.kind}-${e.lt}-${i}`}
            style={{ display: "grid", gridTemplateColumns: "58px 14px 1fr", gap: 10, padding: "11px 0",
              borderBottom: i === entries.length - 1 ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, opacity: 0.7, paddingTop: 2 }}>{e.at}</div>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 4, top: 6, width: 7, height: 7, borderRadius: 999, background: dot, boxShadow: `0 0 10px ${rgba(HOME_THEME.cyan, 0.45)}` }} />
              {i < entries.length - 1 ? <span style={{ position: "absolute", left: 7, top: 0, bottom: -11, width: 1, background: "rgba(255,255,255,0.08)" }} /> : null}
            </div>
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LEVEL_COLOR[e.lt], opacity: 0.85 }}>
                  {LEVEL_LABEL[e.lt]}
                </span>
                {e.kind === "open" ? <span style={{ ...wallBadgeStyle(MUTED), opacity: 0.55 }}>Open baseline</span> : null}
                {e.kind === "change" ? <span style={wallBadgeStyle(C.cyan)}>Changed</span> : null}
                {e.kind === "hit" ? wallBadge(ev?.reaction ?? null, false, ev?.reclaim_min ?? null) : null}
              </div>
              <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>{e.body}</div>
              {e.meta ? <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, opacity: 0.55, marginTop: 6 }}>{e.meta}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
