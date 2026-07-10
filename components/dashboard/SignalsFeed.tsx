"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HOME_THEME as HT } from "@/components/shared/homeTheme";

/**
 * Horizontal signals feed shown above the /home option-chain · heatmap panel
 * (replaced the old NET GEX / CALL WALL / … stat box — those same levels still
 * live on the left "Levels strip" above the GEX chart).
 *
 * Sources, merged newest-first (LEFTMOST = newest), polled every 15s:
 *   1) the live GEX/CB/Flow engine — GET /proxy/signals (server-v2/signals-engine
 *      → trade_signals). Today's (ET) rows are mapped to chips automatically.
 *   2) plain-text signals the user authors in public/signals.txt (served at
 *      /signals.txt) — manual overrides / the alert vocabulary below.
 * Either source can be absent; whatever returns is shown.
 *
 * Line format (see public/signals.txt for the live template + alert vocabulary):
 *     <time>  [<page>]  <signal text>  {<link>}
 *   e.g.  9:45  [Flow] new whale — SPX 7400C $1.2M {/flow}
 *
 * - <time>   leading time token (9:32, 9:32am, 09:32, or 2026-07-09 09:32);
 *            becomes the timestamp and drives ordering. An optional "|"/"-" after
 *            it is stripped.
 * - [<page>] optional source-page tag (CB, Econ, Traders, EM, Flow, Analytics,
 *            Strategy, Scanner, Watch This, Balance) — rendered as an icon-badge
 *            card: a category glyph in a colored tile + a colored time·PAGE line.
 * - {<link>} optional route opened on click (internal "/flow" → client nav;
 *            anything else → new tab).
 * - Ordering: newest time first (leftmost). Untimed lines keep file order and
 *   trail the timed ones. Blank lines and lines starting with "#" are ignored.
 */

type Signal = {
  time: string;
  minutes: number | null;
  page: string;
  text: string;
  link: string;
  key: string;
};

// Optional leading date, required HH:MM, optional am/pm, optional "ET", optional
// "|"/dash separator before the rest of the line.
const TIME_RE = /^\s*(?:\d{4}-\d{2}-\d{2}[ T])?(\d{1,2}):(\d{2})\s*([ap]\.?m?\.?)?\s*(?:ET)?\s*(?:[|\-–—]\s*)?/i;

// Source-page → accent color for the little label chip. Matched on a normalized
// (lowercased) prefix so "Options Flow", "flow" and "FLOW" all hit the same key.
function pageAccent(page: string): string {
  const p = page.trim().toLowerCase();
  if (p.startsWith("cb") || p.includes("bullseye")) return HT.purple;
  if (p.startsWith("econ")) return HT.orange;
  if (p.startsWith("trad")) return HT.cyan;
  if (p.startsWith("em") || p.includes("estimated")) return HT.green;
  if (p.startsWith("flow") || p.includes("option")) return HT.cyan;
  if (p.startsWith("anal")) return HT.cyan;
  if (p.startsWith("strat")) return HT.orange;
  if (p.startsWith("scan")) return HT.green;
  if (p.includes("watch")) return HT.green;
  if (p.includes("balance") || p.includes("imbalance")) return HT.purple;
  return HT.cyan;
}

function parseLine(raw: string, idx: number): Signal | null {
  let line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  // 1) leading time token
  const m = line.match(TIME_RE);
  let time = "";
  let minutes: number | null = null;
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = (m[3] || "").toLowerCase();
    if (ap.startsWith("p") && h < 12) h += 12;
    if (ap.startsWith("a") && h === 12) h = 0;
    minutes = h * 60 + min;
    time = `${m[1]}:${m[2]}${ap ? " " + ap.replace(/\./g, "").toUpperCase() : ""}`;
    line = line.slice(m[0].length).trim();
  }

  // 2) optional [page] tag at the start
  let page = "";
  const pm = line.match(/^\[([^\]]+)\]\s*/);
  if (pm) { page = pm[1].trim(); line = line.slice(pm[0].length).trim(); }

  // 3) optional {link} at the end
  let link = "";
  const lm = line.match(/\s*\{([^}]+)\}\s*$/);
  if (lm) { link = lm[1].trim(); line = line.slice(0, lm.index).trim(); }

  const text = line || raw.trim();
  return { time, minutes, page, text, link, key: `${idx}:${raw}` };
}

function parseSignals(txt: string): Signal[] {
  const parsed = txt
    .split(/\r?\n/)
    .map(parseLine)
    .filter((x): x is Signal => x != null);
  // Newest time first (leftmost). Untimed lines keep order and trail timed ones.
  const timed = parsed.filter((s) => s.minutes != null).sort((a, b) => b.minutes! - a.minutes!);
  const untimed = parsed.filter((s) => s.minutes == null);
  return [...timed, ...untimed];
}

// ── Live engine signals (server-v2/signals-engine.js → GET /proxy/signals) ───
// The GEX/CB/Flow signal engine writes discrete trade_signals rows during the
// futures session. Map each to a feed chip so the home feed shows real,
// page-sourced alerts — merged with the hand-authored signals.txt below, which
// still works as manual overrides. Only today's (ET) rows are kept so the
// time-of-day ordering never wraps across sessions.
type ApiRow = {
  id: number; ts: number; kind: string; direction: string; setup: string;
  level_name: string | null; level_spx: number | null; price_spx: number | null;
};

// kind → source-page tag (drives color/glyph via pageAccent) + click route.
const KIND_PAGE: Record<string, { page: string; link: string }> = {
  flow_divergence:  { page: "Flow",      link: "/flow" },
  cb_reject:        { page: "CB",        link: "/es-candles" },
  cb_break:         { page: "CB",        link: "/es-candles" },
  flip_cross:       { page: "Analytics", link: "/es-candles" },
  wall_reject:      { page: "Analytics", link: "/es-candles" },
  wall_break:       { page: "Analytics", link: "/es-candles" },
  bzila_confluence: { page: "Strategy",  link: "/es-candles" },
  confluence:       { page: "Analytics", link: "/es-candles" },
};

function etDateStr(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
}
function etTime(ts: number): { time: string; minutes: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  const disp = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(ts)).replace(/\s?[AP]M$/i, (s) => " " + s.trim().toUpperCase());
  return { time: disp, minutes: h * 60 + m };
}

function mapApiRows(rows: ApiRow[]): Signal[] {
  const today = etDateStr(Date.now());
  return rows
    .filter((r) => r && Number.isFinite(Number(r.ts)) && etDateStr(Number(r.ts)) === today)
    .map((r) => {
      const meta = KIND_PAGE[r.kind] || { page: "Analytics", link: "/es-candles" };
      const arrow = r.direction === "long" ? "↑" : r.direction === "short" ? "↓" : "";
      const lvl = r.level_spx != null ? ` @ ${Math.round(Number(r.level_spx))}` : "";
      const { time, minutes } = etTime(Number(r.ts));
      return {
        time, minutes, page: meta.page,
        text: `${arrow} ${r.setup}${lvl}`.trim(),
        link: meta.link,
        key: `sig-${r.id}`,
      };
    });
}

// Per-category glyph (stroke SVG, inherits the page accent color). Matched on the
// same normalized page prefix as pageAccent(); falls back to a bell.
function CatGlyph({ page, color }: { page: string; color: string }) {
  const p = page.trim().toLowerCase();
  const props = {
    width: 17, height: 17, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  if (p.startsWith("cb") || p.includes("bullseye"))
    return (<svg {...props}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>);
  if (p.startsWith("econ"))
    return (<svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
  if (p.startsWith("trad"))
    return (<svg {...props}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>);
  if (p.startsWith("em") || p.includes("estimated"))
    return (<svg {...props}><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" /></svg>);
  if (p.startsWith("flow") || p.includes("option"))
    return (<svg {...props}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>);
  if (p.startsWith("anal"))
    return (<svg {...props}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
  if (p.startsWith("strat"))
    return (<svg {...props}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12c1 1 1 2 1 3h6c0-1 0-2 1-3a7 7 0 0 0-4-12z" /></svg>);
  if (p.startsWith("scan"))
    return (<svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
  if (p.includes("watch"))
    return (<svg {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
  if (p.includes("balance"))
    return (<svg {...props}><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0zM17 7l-3 6a3 3 0 0 0 6 0z" /></svg>);
  return (<svg {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>);
}

function Chip({ s }: { s: Signal }) {
  const accent = s.page ? pageAccent(s.page) : HT.cyan;
  const inner = (
    <>
      <span
        style={{
          width: 28, height: 28, borderRadius: 8, background: `${accent}22`, color: accent,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <CatGlyph page={s.page} color={accent} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        {(s.time || s.page) && (
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#8da8c2", whiteSpace: "nowrap" }}>
            {s.time}
            {s.time && s.page ? " · " : ""}
            {s.page && <span style={{ color: accent, fontWeight: 700 }}>{s.page.toUpperCase()}</span>}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf5", whiteSpace: "nowrap" }}>
          {s.text}
          {s.link && <span style={{ marginLeft: 5, color: accent, fontWeight: 400 }}>↗</span>}
        </span>
      </span>
    </>
  );

  const chipStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    flexShrink: 0,
    padding: "7px 13px 7px 10px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderLeft: `3px solid ${accent}`,
    textDecoration: "none",
    cursor: s.link ? "pointer" : "default",
  };

  if (s.link) {
    // Internal route → client-side nav; external URL → new tab.
    if (s.link.startsWith("/")) {
      return <Link href={s.link} title={s.text} style={chipStyle}>{inner}</Link>;
    }
    return <a href={s.link} target="_blank" rel="noreferrer" title={s.text} style={chipStyle}>{inner}</a>;
  }
  return <span title={s.text} style={chipStyle}>{inner}</span>;
}

export default function SignalsFeed({
  src = "/signals.txt",
  pollMs = 15000,
}: { src?: string; pollMs?: number } = {}) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const missingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Live engine signals + the hand-authored file, fetched in parallel. Either
      // source may fail independently (engine off-session, file absent) — merge
      // whatever came back rather than blanking the feed.
      const [apiRes, txtRes] = await Promise.allSettled([
        fetch(`/proxy/signals?limit=40&t=${Date.now()}`, { cache: "no-store" }),
        fetch(`${src}?t=${Date.now()}`, { cache: "no-store" }),
      ]);
      if (cancelled) return;

      let api: Signal[] = [];
      if (apiRes.status === "fulfilled" && apiRes.value.ok) {
        try {
          const j = await apiRes.value.json();
          if (Array.isArray(j?.rows)) api = mapApiRows(j.rows as ApiRow[]);
        } catch { /* ignore malformed engine payload */ }
      }

      let txt: Signal[] = [];
      let txtMissing = false;
      if (txtRes.status === "fulfilled") {
        if (txtRes.value.ok) {
          try { txt = parseSignals(await txtRes.value.text()); } catch { /* ignore */ }
        } else {
          txtMissing = true;
        }
      }
      if (cancelled) return;

      // Merge newest-first (leftmost); untimed manual lines trail the timed ones.
      const merged = [...api, ...txt];
      const timed = merged.filter((s) => s.minutes != null).sort((a, b) => b.minutes! - a.minutes!);
      const untimed = merged.filter((s) => s.minutes == null);
      missingRef.current = txtMissing && api.length === 0;
      setSignals([...timed, ...untimed]);
      setLoaded(true);
    };
    load();
    const id = setInterval(load, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [src, pollMs]);

  return (
    <>
      <style>{`
        .signals-feed-scroll::-webkit-scrollbar { height: 6px; }
        .signals-feed-scroll::-webkit-scrollbar-track { background: transparent; }
        .signals-feed-scroll::-webkit-scrollbar-thumb {
          background: rgba(33,158,188,0.18);
          border-radius: 999px;
        }
        .signals-feed-scroll:hover::-webkit-scrollbar-thumb { background: rgba(33,158,188,0.35); }
        .signals-feed-scroll::-webkit-scrollbar-thumb:hover { background: rgba(33,158,188,0.5); }
      `}</style>
    <div
      className="signals-feed-scroll"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        paddingLeft: 13,
        paddingBottom: 6,
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(33,158,188,0.28) transparent",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: HT.cyan,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        Signals
      </span>
      <span style={{ flexShrink: 0, width: 1, height: 18, background: "rgba(255,255,255,0.12)" }} />

      {signals.length === 0 ? (
        <span style={{ fontSize: 12, color: "#5a7a98", fontWeight: 600 }}>
          {!loaded ? "Loading…" : missingRef.current ? "signals.txt not found" : "No signals yet"}
        </span>
      ) : (
        signals.map((s) => <Chip key={s.key} s={s} />)
      )}
    </div>
    </>
  );
}
