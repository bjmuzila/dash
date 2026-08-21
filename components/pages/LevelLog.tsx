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

/**
 * Quick-select rail in the control bar. The ticker list runs ~150 roots deep and
 * is ordered by rank, not alphabetically, so reaching the three that get opened
 * first meant scrolling the rail or typing into the filter on every visit.
 *
 * A pill whose symbol has no row for the selected date is DISABLED rather than
 * hidden: a missing sweep should read as "nothing recorded", not as a button that
 * moved. All three are in scanner-tickers.js MAIN (the 2m hot lane).
 */
const QUICK_TICKERS = ["SPX", "SPY", "QQQ"] as const;

const WALL_SLOTS = 27;
const LEVEL_LOG_H = 620;
const TICKER_COL_H = 620;

/**
 * One type scale for the whole log card. Before this there were several sizes
 * and three letter-spacings fighting each other inside a single row, which is
 * what made the card read as ragged. Everything in the card uses these three.
 */
const FS_LABEL = 12;   // uppercase chips + eyebrow labels
const FS_BODY = 13;    // the sentence in each row
const FS_META = 12;    // mono: time, GEX line, counters
const LS_LABEL = "0.12em";
/** Height of a row's first line — the badge box. The timeline dot centers on it. */
const ROW_LEAD_H = 20;
/**
 * Height of a rail chip. Explicit for the same reason the badges are (see
 * `wallBadgeStyle`): the label is centered by a fixed height + matching
 * line-height, and the box opts into snapshot.ts's `data-cap-center` rewrite so
 * the capture centers it too. Padding-based chips read fine on the page and
 * rode high in the PNG.
 */
const RAIL_CHIP_H = 24;

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
  break_lt5: "Pushed through to the far side of the level, but by less than the break threshold",
  break_5: "Pushed ≥ 5 pts (0.15% for sub-$1000 names) through to the far side of the level — measured away from the side price approached on, so falling back the way it came never counts",
  consolidated: "Broke through, then the last 3 samples all held on the far side inside a 0.10% range",
  new_wall: "Broke through, and the level itself then rolled in the break direction",
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

/**
 * Badge geometry, deliberately explicit:
 *  - fixed `height` + matching `lineHeight` + border-box → the label sits on the
 *    optical centre instead of riding high off `padding: 2px` and the font's
 *    own leading.
 *  - `textIndent` equal to `letterSpacing` cancels the trailing letter-space
 *    that uppercase tracking adds after the last glyph. Without it every pill
 *    reads shifted left inside its own box.
 */
function wallBadgeStyle(color: string): CSSProperties {
  return {
    display: "inline-block", boxSizing: "border-box",
    height: ROW_LEAD_H, lineHeight: `${ROW_LEAD_H - 2}px`, padding: "0 9px",
    borderRadius: 6, fontSize: FS_LABEL, fontWeight: 800,
    letterSpacing: LS_LABEL, textIndent: LS_LABEL,
    textTransform: "uppercase", whiteSpace: "nowrap", textAlign: "center",
    color, background: rgba(color, 0.13), border: `1px solid ${rgba(color, 0.3)}`,
  };
}

/**
 * `data-cap-center` on every pill. The live page centers the label with a fixed
 * height + matching line-height; html2canvas ignores the line box and draws from
 * the text rect's top using the ascent of whatever font it resolved in its
 * about:blank clone, which put the text high in the PNG. snapshot.ts (gotcha 10)
 * rewrites the opted-in pills to padding-based centering for the capture only.
 */
function wallBadge(rx: WallReaction | null, short = false, reclaimMin: number | null = null): ReactNode {
  if (!rx) return <span data-cap-center style={wallBadgeStyle(MUTED)}>Untested</span>;
  if (isBreakThenReject({ reaction: rx, reclaim_min: reclaimMin })) {
    return (
      <span data-cap-center style={wallBadgeStyle(GREEN)} title={`Broke, then reclaimed after ${reclaimMin}m — failed break`}>
        {short ? "Brk→Rej" : `Break & reject (${reclaimMin}m)`}
      </span>
    );
  }
  const label = short && rx === "consolidated" ? "Consol." : REACTION_LABEL[rx];
  return <span data-cap-center style={wallBadgeStyle(REACTION_COLOR[rx])}>{label}</span>;
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
 * Distance an approach stopped short of the level, in points. Null when the
 * gap rounds to nothing (or either number is missing) so the caller can say
 * "right on the level" instead of printing a meaningless "0.00 short".
 */
const missPts = (strike: number | null | undefined, spot: number | null | undefined): number | null => {
  const s = Number(strike), p = Number(spot);
  if (!Number.isFinite(s) || !Number.isFinite(p)) return null;
  const d = Math.abs(p - s);
  return d < 0.005 ? null : d;
};

/**
 * The level log as plain text, laid out for pasting into Discord or notes.
 * Built from the raw rows rather than scraped out of the rendered timeline, so
 * the copy carries the meta the eye skips. Ordering matches the screen: oldest
 * first, and within one slot the change leads the hit it produced.
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
    const side = approachSide(e);
    const miss = missPts(e.strike, e.spot_at_hit);
    const body = approach
      ? (miss != null
          ? `came ${side === "below" ? "up" : "down"} to ${wallNum(e.spot_at_hit)}, ${wallNum(miss)} short of ${wallStrike(e.strike)}, no tag`
          : `came ${side === "below" ? "up" : "down"} right onto ${wallStrike(e.strike)}, no tag`)
      : `tagged ${wallStrike(e.strike)} from ${side} at ${wallNum(e.spot_at_hit)}`;
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

  lines.sort((a, b) => a.slot - b.slot || (a.hit === b.hit ? 0 : a.hit ? 1 : -1));
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
      // hugTarget: the target IS a card. Without it framed mode reserves its
      // bottom slack INSIDE the card, which read as a dead band between the
      // last entry and the card's bottom border.
      setState(await captureAndCopy(el, filename, { framed: true, hugTarget: true, title }));
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

  // Which quick pills actually have a row today. Built off the unfiltered list,
  // not `shown` — the filter box must not be able to grey out a pill.
  const haveSymbols = useMemo(() => new Set(tickers.map((t) => t.symbol)), [tickers]);

  /**
   * Select a symbol from the quick rail. Also clears the filter box when the
   * current query would hide the row being selected — otherwise the click looks
   * like a no-op: the log switches but the rail shows nothing highlighted.
   */
  const pickTicker = useCallback((sym: string) => {
    setSel(sym);
    setQ((prev) => {
      const query = prev.trim().toUpperCase();
      return query && !sym.includes(query) ? "" : prev;
    });
  }, []);

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
    fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
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
        <span style={{ fontSize: 13, color: C.label }}>
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

        {/* Quick ticker jump. Sits beside the view pills, not in the rail header,
            so it stays put when the rail scrolls. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
          {QUICK_TICKERS.map((sym) => {
            const missing = loaded && !haveSymbols.has(sym);
            return (
              <button
                key={sym}
                onClick={() => pickTicker(sym)}
                disabled={missing}
                style={{
                  ...chipStyle(sel === sym),
                  padding: "6px 10px", fontSize: FS_LABEL, letterSpacing: "0.06em",
                  ...(missing ? { opacity: 0.4, cursor: "not-allowed" } : null),
                }}
                title={missing ? `No ${sym} row recorded for ${date}` : `Jump to ${sym}`}
              >
                {sym}
              </button>
            );
          })}
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
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Tickers — {date}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 13 }}>
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
                    <th style={{ ...th, color: LEVEL_COLOR.cb }}>CORE</th>
                  ) : (
                    <>
                      <th style={{ ...th, color: LEVEL_COLOR.put_wall }}>Put</th>
                      <th style={{ ...th, color: LEVEL_COLOR.call_wall }}>Call</th>
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
                    <td style={td}>{t.changes}</td>
                  </tr>
                ))}
                {loaded && !shown.length ? (
                  <tr><td colSpan={view === "core" ? 4 : 5} style={{ ...td, textAlign: "center", padding: "34px 0", fontFamily: "inherit" }}>
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
            <span style={{ fontSize: FS_LABEL, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase" }}>
              {sel ?? "—"} — {view === "core" ? "core log" : "wall log"}
            </span>
            <span style={{ fontSize: FS_META, fontFamily: "var(--font-mono)" }}>{wallNum(spot)}</span>
            {/* data-capture-hide: live-page chrome, dropped from the screenshot. */}
            <div data-capture-hide style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <CopyLogButton disabled={empty} text={logText} />
              <SnapLogButton disabled={empty} targetRef={logCardRef} filename={snapFile} title={snapTitle} />
            </div>
          </div>

          <WallCaptureRail log={log} events={events} />

          {/* The same session as a picture. Sits ABOVE the scroll body on
              purpose: framed capture expands that body without reflowing its
              siblings, so anything under it gets drawn over in the PNG. */}
          <WallMigrationChart log={log} events={events} view={view} />

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

/**
 * The session rail. Replaced the old 27-square dot matrix, which spent equal
 * width on every slot whether or not anything happened: the empty squares
 * dominated, and reading WHEN something happened meant counting boxes.
 *
 * Two halves, same data:
 *   RAIL  — a continuous track with real hour ticks. Every mark sits at its
 *           TIME, not its slot index, and its shape carries the kind (small dot
 *           = the level moved, filled disc = open, ringed = tag, hollow ring =
 *           came inside the band without tagging). The fill runs to the last
 *           slot captured, so how much session is left is visible at a glance.
 *   CHIPS — the same events written out in order with their clock time, so the
 *           rail never has to be decoded. Quiet stretches collapse to one
 *           "— 45m quiet —" label instead of a run of grey boxes.
 */
type RailMark = {
  slot: number;
  at: string;
  kind: "open" | "change" | "touch" | "approach";
  lt: WallLevel;
  note: string;
};

/** Slot → hour tick. Slot 0 = 09:29, slot 1 = 09:45, then every 15m to 16:00. */
const RAIL_HOURS: { slot: number; label: string }[] = [
  { slot: 2, label: "10" }, { slot: 6, label: "11" }, { slot: 10, label: "12" },
  { slot: 14, label: "13" }, { slot: 18, label: "14" }, { slot: 22, label: "15" },
];
const railPct = (slot: number) => (slot / (WALL_SLOTS - 1)) * 100;

const RAIL_KIND_LABEL: Record<RailMark["kind"], string> = {
  open: "OPEN", change: "MOVE", touch: "TAG", approach: "NEAR",
};

function WallCaptureRail({ log, events }: { log: WallLogRow[]; events: WallEventRow[] }) {
  // One mark per (slot, level). An event outranks a log row at the same slot —
  // "price tagged it" is the story, "the level also moved" is the footnote.
  const byKey = new Map<string, RailMark>();
  const put = (m: RailMark, strong: boolean) => {
    const k = `${m.slot}|${m.lt}`;
    if (!strong && byKey.has(k)) return;
    byKey.set(k, m);
  };
  for (const r of log) {
    if (r.slot < 0 || r.slot >= WALL_SLOTS) continue;
    put({
      slot: r.slot, at: r.at, lt: r.level_type,
      kind: r.reason === "open" ? "open" : "change",
      note: r.reason === "open"
        ? `${LEVEL_LABEL[r.level_type]} baseline ${wallStrike(r.strike)}`
        : `${LEVEL_LABEL[r.level_type]} → ${wallStrike(r.strike)}${r.delta != null ? ` (${r.delta > 0 ? "+" : ""}${wallNum(r.delta)})` : ""}`,
    }, false);
  }
  for (const e of events) {
    if (e.hit_slot < 0 || e.hit_slot >= WALL_SLOTS) continue;
    put({
      slot: e.hit_slot, at: e.at, lt: e.level_type, kind: e.kind === "touch" ? "touch" : "approach",
      note: `${LEVEL_LABEL[e.level_type]} ${e.kind === "touch" ? "tagged" : "approached"} ${wallStrike(e.strike)} · spot ${wallNum(e.spot_at_hit)}`
        + (e.reaction ? ` · ${REACTION_LABEL[e.reaction]}` : ""),
    }, true);
  }

  const marks = [...byKey.values()].sort((a, b) => a.slot - b.slot);
  const lastSlot = marks.length ? marks[marks.length - 1].slot : 0;

  // Colour = the LEVEL (same key the table and timeline use), so a mark on the
  // rail and its row below are obviously the same thing. Kind is carried by the
  // mark's shape instead — colour was already spoken for.
  const dot = (m: RailMark): CSSProperties => {
    const c = LEVEL_COLOR[m.lt];
    const base: CSSProperties = {
      position: "absolute", left: `${railPct(m.slot)}%`, top: "50%",
      transform: "translate(-50%,-50%)", borderRadius: "50%", pointerEvents: "auto",
    };
    if (m.kind === "approach") {
      return { ...base, width: 9, height: 9, background: "transparent", border: `1.5px solid ${c}`, boxShadow: `0 0 8px ${rgba(c, 0.4)}` };
    }
    if (m.kind === "touch") {
      return { ...base, width: 11, height: 11, background: c, border: `2px solid ${HOME_THEME.bg}`, boxShadow: `0 0 0 2px ${rgba(c, 0.3)}, 0 0 12px ${rgba(c, 0.55)}` };
    }
    if (m.kind === "open") {
      return { ...base, width: 9, height: 9, background: c, boxShadow: `0 0 9px ${rgba(c, 0.5)}` };
    }
    return { ...base, width: 7, height: 7, background: c, boxShadow: `0 0 8px ${rgba(c, 0.5)}` };
  };

  return (
    <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
      {/* ── the rail ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, flex: "0 0 auto" }}>09:29</span>
        <div style={{ position: "relative", flex: "1 1 auto", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.055)" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: `${railPct(lastSlot)}%`, borderRadius: 3,
            background: `linear-gradient(90deg, ${rgba(C.cyan, 0.3)}, ${rgba(C.cyan, 0.09)})`,
          }} />
          {RAIL_HOURS.map((h) => (
            <span key={h.slot} aria-hidden style={{
              position: "absolute", left: `${railPct(h.slot)}%`, top: -4, width: 1, height: 14,
              background: "rgba(255,255,255,0.13)",
            }} />
          ))}
          {marks.map((m) => (
            <span key={`${m.slot}|${m.lt}`} title={`${m.at} · ${m.note}`} style={dot(m)} />
          ))}
        </div>
        {/* No "N rows · N slots skipped" counter — the rail and the chips below
            already say what happened and when; a slot tally is bookkeeping. */}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, flex: "0 0 auto" }}>16:00</span>
      </div>
      {/* Hour labels ride under the track, inset by the 09:29 gutter so they
          line up with their ticks rather than with the flex row. */}
      <div style={{ position: "relative", height: 12, margin: "3px 62px 0 52px" }} aria-hidden>
        {RAIL_HOURS.map((h) => (
          <span key={h.slot} style={{
            position: "absolute", left: `${railPct(h.slot)}%`, transform: "translateX(-50%)",
            fontFamily: "var(--font-mono)", fontSize: 10,
          }}>{h.label}</span>
        ))}
      </div>

      {/* ── the same events, spelled out ── */}
      <WallRailChips marks={marks} />
    </div>
  );
}

/** Idea D: the rail's marks as time-stamped chips, quiet stretches collapsed. */
function WallRailChips({ marks }: { marks: RailMark[] }) {
  if (!marks.length) return null;
  const out: ReactNode[] = [];
  let prev = -1;
  for (const m of marks) {
    const gap = m.slot - prev - 1;
    // 3 empty slots = 45 minutes. Below that the label is longer than the run.
    if (prev >= 0 && gap >= 3) {
      out.push(
        <span key={`q${m.slot}`} style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "0 2px" }}>
          — {gap * 15}m quiet —
        </span>,
      );
    }
    const c = LEVEL_COLOR[m.lt];
    // Deliberately inline-BLOCK, not inline-flex. `align-items:center` is a
    // line-box trick html2canvas does not implement — it lays the children out
    // but still draws each label from its rect's top, so the chip text sat high
    // in the PNG while looking centred on the page. A fixed height + matching
    // line-height + `data-cap-center` is the same idiom the badges use, and it
    // is the one snapshot.ts knows how to rewrite for the clone. The flex `gap`
    // becomes explicit right-margins, since inline-block has no gap.
    out.push(
      <span key={`${m.slot}|${m.lt}`} title={m.note} data-cap-center style={{
        display: "inline-block", boxSizing: "border-box",
        height: RAIL_CHIP_H, lineHeight: `${RAIL_CHIP_H - 2}px`, padding: "0 9px 0 7px",
        borderRadius: 7, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.028)",
        fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "nowrap",
      }}>
        <span style={{
          display: "inline-block", verticalAlign: "middle", marginRight: 7,
          width: 6, height: 6, borderRadius: "50%",
          background: m.kind === "approach" ? "transparent" : c,
          border: m.kind === "approach" ? `1.5px solid ${c}` : undefined,
          boxShadow: m.kind === "approach" ? undefined : `0 0 7px ${rgba(c, 0.55)}`,
        }} />
        <span style={{ marginRight: 7 }}>{m.at}</span>
        <b style={{ fontWeight: 700, marginRight: 7 }}>{RAIL_KIND_LABEL[m.kind]}</b>
        {/* `textIndent` has no effect on an inline box, so the trailing
            letter-space of the uppercase tracking is cancelled with a negative
            right margin instead — otherwise the chip reads padded-right. */}
        <span style={{ fontSize: 10, letterSpacing: LS_LABEL, textTransform: "uppercase", color: c, marginRight: "-0.12em" }}>
          {LEVEL_LABEL[m.lt]}
        </span>
      </span>,
    );
    prev = m.slot;
  }
  const toClose = WALL_SLOTS - 1 - prev;
  if (toClose >= 3) {
    out.push(
      <span key="qend" style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "0 2px" }}>
        — {toClose * 15}m to close —
      </span>,
    );
  }
  return <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>{out}</div>;
}

// ── Wall migration ───────────────────────────────────────────────────────────

/** Chart body height in px. The SVG scales to the card's width, not this. */
const MIG_H = 172;
/** Top/bottom breathing room inside the plot, so a line never rides the edge. */
const MIG_PAD = 10;

/**
 * WALL MIGRATION — the level log drawn: where each level sat, slot by slot,
 * against the price captured with it.
 *
 * Ported from the post-market recap's chart (components/pages/premarket/
 * PostMarketTab.tsx → WallChart), with one deliberate difference. That version
 * has no recorded level series to read: it reconstructs the walls out of the
 * per-minute strike ladder and labels itself a "net-basis proxy" — and that
 * ladder is SPX-only, which is why the chart could not travel as written. Here
 * the levels ARE recorded, per symbol, by server-v2/walls-recorder.js. So this
 * draws the log's own strikes, no proxy, and works for every ticker on the rail.
 *
 * Two honest consequences of reading the log instead of a ladder:
 *
 *   1. walls_log is CHANGE-ONLY, so each series is forward-filled from its last
 *      written row. That is exactly what the level did — a wall holds its strike
 *      until it rolls — which is why every level is a STEP and never a slope. A
 *      diagonal between two captures would draw the level at prices it never
 *      occupied, which is precisely the reading this panel exists for.
 *   2. Spot is only stored on the slots that wrote a row, plus the touch and
 *      approach events. The price line is therefore those captures joined up,
 *      not a tick path, and the caption says how many there were rather than
 *      implying a continuous tape.
 *
 * Nothing is filled in. A level with no rows for the day is simply not drawn,
 * and the whole panel disappears rather than render an empty frame.
 *
 * It reads the same view-filtered `log` / `events` as the rail and the timeline,
 * so the WALLS / CORE switch scopes it along with everything else — and it uses
 * railPct() for x, so a mark on the rail above sits directly over its step here.
 */
function WallMigrationChart({ log, events, view }: {
  log: WallLogRow[]; events: WallEventRow[]; view: LogView;
}) {
  const model = useMemo(() => {
    const inSlot = (s: number) => Number.isFinite(s) && s >= 0 && s < WALL_SLOTS;

    // How much session has been captured. Same definition the rail's fill uses,
    // so the two never disagree about where "now" is.
    let lastSlot = 0;
    for (const r of log) if (inSlot(r.slot) && r.slot > lastSlot) lastSlot = r.slot;
    for (const e of events) if (inSlot(e.hit_slot) && e.hit_slot > lastSlot) lastSlot = e.hit_slot;

    // Only level types this view covers AND that actually have rows today.
    const levels = VIEW_LEVELS[view].filter((lt) => log.some((r) => r.level_type === lt));
    if (!levels.length) return null;

    // Forward-fill: at slot s a level is whatever it was last written as.
    const series = new Map<WallLevel, (number | null)[]>();
    for (const lt of levels) {
      const rows = log
        .filter((r) => r.level_type === lt && inSlot(r.slot) && Number.isFinite(Number(r.strike)))
        .sort((a, b) => a.slot - b.slot);
      const out: (number | null)[] = new Array(WALL_SLOTS).fill(null);
      let cur: number | null = null;
      let i = 0;
      for (let s = 0; s <= lastSlot; s++) {
        while (i < rows.length && rows[i].slot <= s) { cur = Number(rows[i].strike); i++; }
        out[s] = cur;
      }
      series.set(lt, out);
    }

    // Spot, from every capture that carried one. Events are written second so a
    // tag's spot_at_hit wins over the level row at the same slot — the tag is
    // the more precise reading of where price actually was.
    const spot: (number | null)[] = new Array(WALL_SLOTS).fill(null);
    for (const r of log) {
      if (inSlot(r.slot) && Number.isFinite(Number(r.spot)) && Number(r.spot) > 0) spot[r.slot] = Number(r.spot);
    }
    for (const e of events) {
      if (inSlot(e.hit_slot) && Number.isFinite(Number(e.spot_at_hit)) && Number(e.spot_at_hit) > 0) {
        spot[e.hit_slot] = Number(e.spot_at_hit);
      }
    }
    const spotPts = spot.map((v, s) => ({ s, v })).filter((p) => p.v != null) as { s: number; v: number }[];

    const vals: number[] = [];
    for (const arr of series.values()) for (const v of arr) if (v != null) vals.push(v);
    for (const p of spotPts) vals.push(p.v);
    if (vals.length < 2) return null;

    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (!(hi > lo)) { const c = lo || 1; lo = c * 0.999; hi = c * 1.001; }
    const padY = (hi - lo) * 0.08;
    lo -= padY; hi += padY;

    return { levels, series, spot, spotPts, lo, hi, lastSlot };
  }, [log, events, view]);

  if (!model) return null;
  const { levels, series, spotPts, lo, hi, lastSlot } = model;

  const x = (s: number) => railPct(s);
  const y = (v: number) => MIG_PAD + (1 - (v - lo) / (hi - lo)) * (MIG_H - MIG_PAD * 2);

  /** Step, not slope — see the header. Walk forward or back over the fill. */
  const step = (arr: (number | null)[], reverse = false) => {
    const out: string[] = [];
    let prev: number | null = null;
    const push = (s: number) => {
      const v = arr[s];
      if (v == null) return;
      if (prev != null && v !== prev) out.push(`${x(s)},${y(prev)}`);
      out.push(`${x(s)},${y(v)}`);
      prev = v;
    };
    if (reverse) for (let s = lastSlot; s >= 0; s--) push(s);
    else for (let s = 0; s <= lastSlot; s++) push(s);
    return out.join(" ");
  };

  const paths = levels.map((lt) => ({ lt, d: step(series.get(lt) ?? []) })).filter((p) => p.d);
  // The corridor between the two walls — the room price actually had. Only in
  // the WALLS view, where there are two of them to bound it.
  const corridor = paths.length === 2
    ? `${paths[0].d} ${step(series.get(paths[1].lt) ?? [], true)}`
    : null;
  const spotLine = spotPts.map((p) => `${x(p.s)},${y(p.v)}`).join(" ");
  const lastOf = (lt: WallLevel) => {
    const arr = series.get(lt) ?? [];
    for (let s = lastSlot; s >= 0; s--) if (arr[s] != null) return arr[s] as number;
    return null;
  };

  const legendChip = (color: string, label: string, value: string) => (
    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ width: 10, height: 3, borderRadius: 2, background: color, boxShadow: `0 0 8px ${rgba(color, 0.5)}` }} />
      <span style={{ fontSize: 10, letterSpacing: LS_LABEL, textTransform: "uppercase", color }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META }}>{value}</span>
    </span>
  );

  return (
    <div style={{ padding: "13px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 9 }}>
        <span style={{ fontSize: FS_LABEL, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase" }}>
          Wall migration
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: FS_META }}>
          recorded levels · {spotPts.length} spot capture{spotPts.length === 1 ? "" : "s"}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {paths.map((p) => legendChip(LEVEL_COLOR[p.lt], LEVEL_LABEL[p.lt], wallStrike(lastOf(p.lt))))}
          {spotPts.length ? legendChip(HOME_THEME.text, "Spot", wallNum(spotPts[spotPts.length - 1].v)) : null}
        </span>
      </div>

      <div style={{ position: "relative" }}>
        {/* preserveAspectRatio="none" — the x axis is slots, the y axis is
            price, and the two have no business sharing a scale. Every stroke
            carries vectorEffect so the squash never thickens a line, and there
            is no <text> or <circle> inside for the same reason: they would come
            out stretched. Labels are HTML, on top. */}
        <svg viewBox={`0 0 100 ${MIG_H}`} height={MIG_H} preserveAspectRatio="none"
          style={{ width: "100%", display: "block", overflow: "visible" }}>
          {RAIL_HOURS.map((h) => (
            <line key={h.slot} x1={x(h.slot)} x2={x(h.slot)} y1={0} y2={MIG_H}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {corridor ? <polygon points={corridor} fill={rgba(C.cyan, 0.06)} /> : null}
          {paths.map((p) => (
            <polyline key={p.lt} points={p.d} fill="none" stroke={LEVEL_COLOR[p.lt]} strokeWidth={2}
              vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
          ))}
          {/* Spot last, so it reads on top of the levels it is being compared
              with. The ticks mark the captures themselves — vertical only,
              because a horizontal mark would be stretched by the squash. */}
          {spotPts.length > 1 ? (
            <polyline points={spotLine} fill="none" stroke={HOME_THEME.text} strokeWidth={1.4}
              vectorEffect="non-scaling-stroke" opacity={0.85} />
          ) : null}
          {spotPts.map((p) => (
            <line key={p.s} x1={x(p.s)} x2={x(p.s)} y1={y(p.v) - 2.5} y2={y(p.v) + 2.5}
              stroke={HOME_THEME.text} strokeWidth={1.4} vectorEffect="non-scaling-stroke" opacity={0.9} />
          ))}
        </svg>
        {/* Price bounds as HTML, right-aligned over the plot. */}
        <span style={{ position: "absolute", right: 0, top: 0, fontFamily: "var(--font-mono)", fontSize: 10, pointerEvents: "none" }}>
          {wallStrike(hi)}
        </span>
        <span style={{ position: "absolute", right: 0, bottom: 0, fontFamily: "var(--font-mono)", fontSize: 10, pointerEvents: "none" }}>
          {wallStrike(lo)}
        </span>
      </div>

      {/* Same ticks as the rail above, so the two line up column for column. */}
      <div style={{ position: "relative", height: 12, marginTop: 3 }} aria-hidden>
        <span style={{ position: "absolute", left: 0, fontFamily: "var(--font-mono)", fontSize: 10 }}>09:29</span>
        {RAIL_HOURS.map((h) => (
          <span key={h.slot} style={{
            position: "absolute", left: `${railPct(h.slot)}%`, transform: "translateX(-50%)",
            fontFamily: "var(--font-mono)", fontSize: 10,
          }}>{h.label}</span>
        ))}
        <span style={{ position: "absolute", right: 0, fontFamily: "var(--font-mono)", fontSize: 10 }}>16:00</span>
      </div>

      <div style={{ fontSize: FS_META, marginTop: 8, lineHeight: 1.5 }}>
        Each level holds its strike until the recorder writes a change, so the steps are the rolls. A level that
        sits while price travels is the one to fade; one that moves with price is dealers chasing. Spot is drawn
        from the {spotPts.length} capture{spotPts.length === 1 ? "" : "s"} stored for this ticker today — the
        level log&apos;s own samples, not a tick path.
      </div>
    </div>
  );
}

/**
 * Which side price came from. A CORE tag at 7772.97 on the 7775 level was
 * approached from BELOW, so a break is upward — price falling away afterwards
 * is a rejection, not a break. Reading a row without this is the "don't know
 * which direction the stock comes from" problem: the numbers alone are
 * ambiguous, and "broke by 18.77" against a level price never touched from
 * above is simply the wrong story.
 *
 * Walls have a fixed side (a call wall is tested from below, a put wall from
 * above). CORE has none, so it comes off spot vs. strike at the tag.
 */
function approachSide(e: { level_type: WallLevel; strike: number; spot_at_hit: number }): "below" | "above" {
  if (e.level_type === "call_wall") return "below";
  if (e.level_type === "put_wall") return "above";
  return Number(e.spot_at_hit) <= Number(e.strike) ? "below" : "above";
}

/** Chronological merge of level changes and classified hits. */
function WallTimeline({ log, events, view }: { log: WallLogRow[]; events: WallEventRow[]; view: LogView }) {
  type Entry = {
    slot: number; at: string; kind: "open" | "change" | "hit"; lt: WallLevel;
    body: ReactNode; meta?: string; side?: "below" | "above";
  };
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
    const side = approachSide(e);
    // How far the approach stopped short. The old line read "Came up down to
    // 7,700 from above at 7,710.20" — a hardcoded "Came up" with the direction
    // bolted on after it, and the two numbers left for the reader to subtract.
    // One direction word, then the distance stated outright.
    const miss = missPts(e.strike, e.spot_at_hit);
    entries.push({
      slot: e.hit_slot, at: e.at, kind: "hit", lt: e.level_type, side,
      body: approach
        ? <>Came {side === "below" ? "up" : "down"} to <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(e.spot_at_hit)}</b>
            {miss != null
              ? <> — <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(miss)}</b> short of <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b>, never tagged</>
              : <>, right on <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b> but never tagged</>}
            {e.note ? ` — ${e.note}.` : "."}</>
        : <>Tagged <b style={{ fontFamily: "var(--font-mono)" }}>{wallStrike(e.strike)}</b> from {side} at <b style={{ fontFamily: "var(--font-mono)" }}>{wallNum(e.spot_at_hit)}</b>{e.note ? ` — ${e.note}.` : "."}</>,
      meta: [
        // Excursion is measured in the BREAK direction, which is the opposite
        // side from the one price approached on. Spelling that out is the whole
        // point — an unsigned "+18.77" beside a level price tells you nothing
        // about whether price went through the level or fell away from it.
        !approach && e.excursion_pts != null
          ? (Number(e.excursion_pts) >= 0
              ? `pushed ${wallNum(Math.abs(Number(e.excursion_pts)))} ${side === "below" ? "up through" : "down through"}`
              : `stayed ${wallNum(Math.abs(Number(e.excursion_pts)))} short of it`)
          : null,
        e.reclaim_min != null ? `reclaimed in ${e.reclaim_min}m` : null,
        !approach && e.attempts > 1 ? `attempt ${e.attempts} on this strike` : null,
        e.was_core ? (e.core_held === false ? "was the CORE — CORE moved after" : "was the CORE") : null,
        e.gex_at_hit != null ? `GEX at level ${gexShort(e.gex_at_hit)}` : null,
        build != null ? `${build >= 0 ? "built" : "bled"} ${Math.abs(build).toFixed(0)}% by resolve` : null,
        e.reaction == null ? "watching — resolves 4 slots after the tag" : null,
      ].filter(Boolean).join(" · "),
    });
  }

  // Oldest first — the session reads top to bottom in the order it happened,
  // so the open baseline leads and the latest slot lands at the bottom. Within
  // one slot the change comes first and the hit it produced follows it.
  const kindRank = (k: Entry["kind"]) => (k === "hit" ? 1 : 0);
  entries.sort((a, b) => a.slot - b.slot || kindRank(a.kind) - kindRank(b.kind));

  const evByKey = new Map(events.map((e) => [`${e.hit_slot}|${e.level_type}`, e]));

  if (!entries.length) {
    return (
      <div style={{ padding: "34px 18px", textAlign: "center", fontSize: FS_BODY }}>
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
        const last = i === entries.length - 1;
        return (
          <div key={`${e.slot}-${e.kind}-${e.lt}-${i}`}
            style={{ display: "grid", gridTemplateColumns: "58px 14px 1fr", gap: 10, padding: "11px 0",
              borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
            {/* Time, dot and badge row all lock to ROW_LEAD_H so the three
                columns sit on one optical line instead of each finding its own
                baseline off whatever line-height its font happened to use. */}
            <div style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, lineHeight: `${ROW_LEAD_H}px` }}>{e.at}</div>
            {/* No fixed height here — the cell stretches to the row so the
                connector can run all the way down to the next dot. */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 3.5, top: (ROW_LEAD_H - 7) / 2, width: 7, height: 7, borderRadius: 999, background: dot, boxShadow: `0 0 10px ${rgba(HOME_THEME.cyan, 0.45)}` }} />
              {!last ? <span style={{ position: "absolute", left: 6.5, top: (ROW_LEAD_H + 7) / 2 + 3, bottom: -11, width: 1, background: "rgba(255,255,255,0.08)" }} /> : null}
            </div>
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minHeight: ROW_LEAD_H }}>
                <span style={{ fontSize: FS_LABEL, lineHeight: `${ROW_LEAD_H}px`, fontWeight: 800, letterSpacing: LS_LABEL, textTransform: "uppercase", color: LEVEL_COLOR[e.lt] }}>
                  {LEVEL_LABEL[e.lt]}
                </span>
                {e.kind === "open" ? <span data-cap-center style={wallBadgeStyle(MUTED)}>Open baseline</span> : null}
                {e.kind === "change" ? <span data-cap-center style={wallBadgeStyle(C.cyan)}>Changed</span> : null}
                {e.kind === "hit" ? wallBadge(ev?.reaction ?? null, false, ev?.reclaim_min ?? null) : null}
                {/* Direction of approach, stated up front rather than left to be
                    inferred from spot vs. strike further down the row. */}
                {e.side ? (
                  <span title={e.side === "below" ? "Price came into the level from below — a break goes up" : "Price came into the level from above — a break goes down"}
                    style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, lineHeight: `${ROW_LEAD_H}px`, color: e.side === "below" ? GREEN : RED }}>
                    {e.side === "below" ? "↑ from below" : "↓ from above"}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: FS_BODY, marginTop: 4, lineHeight: 1.5 }}>{e.body}</div>
              {e.meta ? <div style={{ fontFamily: "var(--font-mono)", fontSize: FS_META, marginTop: 6, lineHeight: 1.5 }}>{e.meta}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
