"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle, DOCK_THEME } from "@/components/shared/homeTheme";
// Same chip logo the home Economic Calendar panel uses: mirrored
// public/logos/<SYM>.png first (same-origin, immutably cached), then the live
// /proxy/ticker-logo resolver, then a ticker-text chip. This page used to hit
// the resolver directly, so mirrored logos never showed up here.
import ChipLogo from "@/components/shared/ChipLogo";
import {
  groupEarningsByDate,
  bucketCount,
  pickAnticipated,
  etMonFri,
  ANTICIPATED_PER_DAY,
} from "@/lib/econCalendar";

interface CalEvent {
  date: string;
  time: string;
  time_formatted: string;
  title: string;
  country: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
}

interface EarnRow {
  date: string;                          // YYYY-MM-DD (ET)
  symbol: string;
  company: string;
  session: "pre" | "after" | "unknown";
  market_cap: number;
  eps_est: string | null;
}

const CHIP_W = 46;
const CHIP_GAP = 10;

/**
 * Week-board chip geometry.
 *
 * The logo was 30px in a track that resolves to ~57px on a five-column week —
 * so every tile carried ~25px of dead air around a small mark, and a column
 * with two names was mostly empty box. 42px is the largest logo that still
 * clears the tile's 3px side padding at the SAME four-across track, so the
 * chips get bigger without the grid reflowing to three per row (which would
 * have made a nine-name Wednesday taller, not denser).
 *
 * Keep these two in step: CHIP_LOGO + 6px of padding must stay under the track
 * width CHIP_MIN resolves to, or the logo drives the column width instead of
 * the other way round.
 */
const CHIP_LOGO = 42;
const CHIP_MIN = 52;

/**
 * Mono stack with REAL fallbacks, for everything inside the screenshot target.
 *
 * `font-family: var(--font-mono)` alone is a trap in a capture. html2canvas
 * clones the page into an about:blank iframe where the :root custom properties
 * are not defined, so the declaration resolves to nothing: the CLONE lays the
 * text out in the inherited sans, while html2canvas paints it with whatever its
 * own parse of the family string produced. Different metrics for measuring and
 * for drawing is how a pill ends up hugging a width its own text then overflows,
 * and how two runs at different sizes drift apart vertically.
 *
 * Naming concrete families after the variable costs nothing on the live page —
 * `var(--font-mono)` still wins there — and gives the clone something real to
 * fall back to, so the box it measures is the box the glyphs get drawn in.
 */
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

// ─────────────────────────────────────────────────────────────────────────────
//  EARNINGS BOARD SURFACES
//
//  HT.panelBg is rgba(13,17,25,0.45) — a dark panel at 45% over a near-black
//  page. On a surface that is MOSTLY card (the week board is five columns of
//  them edge to edge) that lands almost on the background and the whole tab
//  reads as one flat black rectangle: the cards were there, they just had no
//  luminance to separate them.
//
//  So the board's cards are lifted with a WHITE alpha over the panel rather
//  than by picking a lighter hex. Three reasons: it keeps tracking HT.panelBg
//  if the theme moves, it stays neutral instead of drifting blue, and it is the
//  same rung system the rest of the app uses for hover/active states.
//
//  Three levels, and the gap between them is what makes the board readable:
//    CARD  — a day column. The lightest thing on the page.
//    HEAD  — its date strip, one rung up from the card so the date has a plate.
//    TILE  — a ticker chip, one rung DOWN from the card so the chips read as
//            objects sitting ON the column rather than holes cut into it.
// ─────────────────────────────────────────────────────────────────────────────
const BOARD = {
  /** Day column / board header fill. */
  card: `linear-gradient(180deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.045) 100%), ${HT.panelBg}`,
  /** Same, tinted cyan for today. */
  cardToday: `linear-gradient(180deg, rgba(33,158,188,0.16) 0%, rgba(255,255,255,0.05) 55%), ${HT.panelBg}`,
  /** The board's own branded header. Same lift, deeper cyan ramp. */
  header: `linear-gradient(180deg, rgba(33,158,188,0.18) 0%, rgba(255,255,255,0.05) 75%), ${HT.panelBg}`,
  /** Date strip across the top of a column. */
  head: "rgba(255,255,255,0.06)",
  headToday: "rgba(33,158,188,0.14)",
  /** One ticker chip. */
  tile: "rgba(255,255,255,0.035)",
  /** Card edge. A touch stronger than HT.border, which disappears at this fill. */
  edge: "rgba(255,255,255,0.16)",
  edgeToday: "rgba(33,158,188,0.55)",
  /** Divider between the PRE / AFTER / TBD blocks inside a column. */
  rule: "rgba(255,255,255,0.09)",
} as const;

// Sub-billion names are in the feed now that the recorder has no mcap floor
// (KNOP, DLTH, DAKT, BLRX…), and the old `Math.round(n/1e9)}B` rendered every
// one of them as "$0B" — which looked like missing data on exactly the names
// that had just been un-hidden.
function fmtMcap(n: number) {
  if (!n) return "n/a";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${Math.round(n / 1e9)}B`;
  return `$${Math.round(n / 1e6)}M`;
}

/**
 * "MONDAY" / "AUG 24" for the earnings week board's day headers.
 *
 * Full weekday, not the three-letter form. The board is five wide columns and
 * the abbreviation was reading as a label on the date rather than as the day —
 * "MONDAY AUG 31" is what a week board says. It fits: the header is a
 * three-column grid whose middle track sizes to content, and the longest pair
 * (WEDNESDAY SEP 2) is still well inside the 210px column minimum.
 */
function dayFull(dateStr: string) {
  return new Date(dateStr + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
}
function dayDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

const IMPACT_COLOR: Record<string, string> = {
  High:      HT.red,
  Medium:    "#f59e0b",
  Low:       "#3a5570",
  Holiday:   "#6b7280",
  President: "#a855f7",
};

function impactColor(i: string) { return IMPACT_COLOR[i] ?? "#3a5570"; }

type FilterKey = "high-usd" | "high" | "medium-usd" | "medium" | "low-usd" | "low" | "trump" | "all";

const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "high-usd",   label: "High · USD",   color: HT.red },
  { value: "high",       label: "High",         color: HT.red },
  { value: "medium-usd", label: "Medium · USD", color: "#f59e0b" },
  { value: "medium",     label: "Medium",       color: "#f59e0b" },
  { value: "low-usd",    label: "Low · USD",    color: "#3a5570" },
  { value: "low",        label: "Low",          color: "#3a5570" },
  { value: "trump",      label: "TRUMP",        color: "#a855f7" },
  { value: "all",        label: "All",          color: HT.text },
];

// Earnings market-cap floor for the dropdown. The recorder stores everything at
// or above EARNINGS_MIN_MCAP (currently $25B), so this is a pure client-side
// narrowing of rows already in hand — changing it never refetches. 0 = show
// whatever the feed returned, which is the honest default: a hardcoded floor
// here would silently re-hide the names the server was just widened to include.
const MCAP_OPTS: { value: number; label: string }[] = [
  { value: 0,     label: "All caps" },
  { value: 1e9,   label: "≥ $1B"    },
  { value: 10e9,  label: "≥ $10B"   },
  { value: 25e9,  label: "≥ $25B"   },
  { value: 100e9, label: "≥ $100B"  },
  { value: 1e12,  label: "≥ $1T"    },
];

/**
 * How many names the board shows.
 *
 * "Anticipated" is the shared rule in lib/econCalendar (mcap ≥ $25B, OR on the
 * maintained interest list, then topped up to ~14/day by size). "All" is every
 * name Nasdaq lists for the week — several hundred a day, which is a legitimate
 * thing to want and a terrible default.
 *
 * This exists at ALL because the recorder used to do this narrowing server-side
 * with a hard $25B cut, so "all" was never actually reachable from the UI: the
 * missing names had never been stored.
 */
type ViewKey = "anticipated" | "all";
const VIEW_OPTS: { value: ViewKey; label: string; hint: string }[] = [
  { value: "anticipated", label: "Anticipated", hint: "Most-watched names, ~14 per day" },
  { value: "all",         label: "All",         hint: "Every name on the Nasdaq calendar" },
];

function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("trump")      && ev.impact === "President") return true;
  if (active.has("high-usd")   && ev.impact === "High"   && ev.country === "USD") return true;
  if (active.has("high")       && ev.impact === "High") return true;
  if (active.has("medium-usd") && ev.impact === "Medium" && ev.country === "USD") return true;
  if (active.has("medium")     && ev.impact === "Medium") return true;
  if (active.has("low-usd")    && ev.impact === "Low"    && ev.country === "USD") return true;
  if (active.has("low")        && ev.impact === "Low") return true;
  return false;
}

function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function etNowParts(nowMs: number): { date: string; minutes: number } {
  const d = new Date(nowMs);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  const [h, m] = hm.split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

function isStale(ev: CalEvent, nowMs: number): boolean {
  const { date: etDate, minutes: nowMin } = etNowParts(nowMs);
  if (ev.date < etDate) return true;
  if (ev.date > etDate) return false;
  if (!ev.time) return false;
  const [h, m] = ev.time.split(":").map(Number);
  return nowMin - (h * 60 + m) > 30;
}

function fullDayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
}

export default function EconomicCalendarPage() {
  // Feed-health text is OWNER-ONLY — it names upstream hosts, HTTP status codes
  // and cache timestamps. Strict derivation (claim OR explicit id match) so a
  // build missing NEXT_PUBLIC_OWNER_USER_ID fails CLOSED rather than showing the
  // diagnostics to every signed-in customer.
  const { user, isOwnerClaim } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  const isOwner = isOwnerClaim || (!!ownerId && user?.id === ownerId);

  const [events,        setEvents]        = useState<CalEvent[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [warning,       setWarning]       = useState<string | null>(null);
  const [lastRefresh,   setLastRefresh]   = useState<string | null>(null);
  const [quote,         setQuote]         = useState<string | null>(null);
  const [now,           setNow]           = useState(() => Date.now());
  const [search,        setSearch]        = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(["all"]));
  const [dropOpen,      setDropOpen]      = useState(false);
  const [earnings,      setEarnings]      = useState<EarnRow[]>([]);
  const [activeTab,     setActiveTab]     = useState<"calendar" | "earnings">("calendar");
  // Earnings market-cap floor, in dollars. 0 = no floor (see MCAP_OPTS).
  const [mcapMin,       setMcapMin]       = useState(0);
  const [capOpen,       setCapOpen]       = useState(false);
  // Which Mon–Fri the board shows. 0 = this week, 1 = next. The feed carries
  // both, so flipping this is a filter, not a refetch.
  const [earnWeek,      setEarnWeek]      = useState<0 | 1>(0);
  const [earnView,      setEarnView]      = useState<ViewKey>("anticipated");
  // Drives the screenshot button's label only. "copied"/"saved" are the two
  // success outcomes — the clipboard write is the intent, the download is the
  // fallback the browser forces, and the button has to say which happened or a
  // Firefox user stares at a "✓" wondering why Ctrl+V does nothing.
  const [shot,          setShot]          = useState<"idle" | "working" | "copied" | "saved" | "failed">("idle");
  const dropRef   = useRef<HTMLDivElement>(null);
  const capRef    = useRef<HTMLDivElement>(null);
  const shotRef   = useRef<HTMLDivElement>(null);   // whole page, incl. toolbar
  const scrollRef = useRef<HTMLDivElement>(null);   // the clipping scroll box
  const earnRef   = useRef<HTMLDivElement>(null);   // the earnings week board only

  useEffect(() => {
    function h(e: MouseEvent) {
      const t = e.target as Node;
      if (dropRef.current && !dropRef.current.contains(t)) setDropOpen(false);
      if (capRef.current  && !capRef.current.contains(t))  setCapOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  /**
   * Snapshot → CLIPBOARD (falls back to a download only when the browser will
   * not take an image write — see copyOrDownload).
   *
   * WHAT gets captured depends on the tab, and that is the point:
   *   - earnings tab → `earnRef`, the week board ALONE. Not the page toolbar,
   *     not the filter dropdowns, not the search box. The board carries its own
   *     header (CB Edge mark + week range + name count), so the pasted image is
   *     a self-contained card rather than a screenshot of an app.
   *   - calendar tab → the whole page, as before.
   *
   * Two things make this less trivial than handing the node to html2canvas:
   *
   * 1. The list lives in a `flex:1; overflow-y:auto` box, and html2canvas clips
   *    to the element's box. A week that runs past the fold would be cut off at
   *    exactly the fold. So the scroll box (and the 100%-height shell around it)
   *    are expanded to their natural height for the capture and restored in
   *    `finally` — including on the error path, or the page would be left with a
   *    broken layout after a failed screenshot.
   * 2. Ticker logos that fall through to /proxy/ticker-logo end up 302'd to a
   *    third-party host. Drawing one of those into the canvas TAINTS it and
   *    toBlob then throws SecurityError, killing the whole screenshot over a
   *    16px image — which is exactly what the earnings tab was doing, because
   *    that tab is nothing BUT logo chips and several of its names are not
   *    mirrored yet.
   *
   *    `allowTaint:false` alone did not fix it: html2canvas decides whether to
   *    request an image in CORS mode by looking at the src STRING, and
   *    `/proxy/ticker-logo?...` reads as same-origin, so it never saw the
   *    redirect coming (lib/snapshot.ts gotcha 9). The flag now also makes the
   *    engine REMOVE those images from the clone — ChipLogo tags the proxy
   *    stage `data-snap-untrusted` — leaving the same ticker-text chip the page
   *    shows when a logo 404s. Locally-mirrored logos in public/logos are real
   *    same-origin files and still draw normally.
   */
  const takeShot = useCallback(async () => {
    // The earnings board is its own capture target; the calendar tab still
    // captures the page shell. Falling back to the shell keeps the button
    // working if the board is not mounted (empty week).
    const earnMode = activeTab === "earnings" && !!earnRef.current;
    const el = earnMode ? earnRef.current! : shotRef.current;
    if (!el || shot === "working") return;
    setDropOpen(false);
    setCapOpen(false);
    setShot("working");

    // Only the page-shell capture has to fight the scroll container: the board
    // IS the scroller's content, so its own box is already the full height.
    const sc = earnMode ? null : scrollRef.current;
    const prevSc = sc ? { overflowY: sc.style.overflowY, height: sc.style.height, flex: sc.style.flex } : null;
    const prevEl = { height: el.style.height, overflow: el.style.overflow };
    if (sc) { sc.style.overflowY = "visible"; sc.style.height = "auto"; sc.style.flex = "none"; }
    if (!earnMode) {
      el.style.height = "auto";
      el.style.overflow = "visible";
    }

    try {
      // Dynamic import: the snapshot engine pulls in a ~200KB rendering
      // dependency, and nobody pays for it until they press the button.
      //
      // This goes through lib/snapshot.ts rather than calling html2canvas
      // directly. scripts/audit-ui.mjs --strict FAILS THE BUILD on a second
      // engine, and the reason is not tidiness: the module owns a pile of
      // html2canvas workarounds (gradient headings render invisible,
      // backdrop-filter is unimplemented, live <canvas> bitmaps do not survive
      // the clone, cloned <script> tags 404 from about:blank) that a hand-rolled
      // call site silently does without.
      const { captureAndCopy } = await import("@/lib/snapshot");
      await new Promise(r => requestAnimationFrame(() => r(null)));  // let the re-layout settle
      // etToday() rather than the `today` const — that is declared further down
      // and would be in its TDZ at the point this callback is created.
      const where = await captureAndCopy(
        el,
        `${earnMode ? `earnings-${earnWeek === 0 ? "this" : "next"}-week` : "econ-calendar"}-${etToday()}.png`,
        {
          background: HT.bg,   // else transparent, which reads black-on-black in most viewers
          // See the ticker-logo note above: a 302'd third-party logo taints the
          // canvas and toBlob then throws. The engine defaults to allowTaint:true
          // for the chart panels, which carry no foreign images; this page does.
          allowTaint: false,
          // A logo that never answers must not hold the capture: html2canvas
          // waits 15s per image by default, and the earnings tab has one chip per
          // name. A skipped logo costs a chip, not the PNG.
          imageTimeout: 4000,
          // The board already paints its own header, so framing it a SECOND time
          // would stack two titles. The page capture keeps the plain form it has
          // always had. Either way the CB Edge mark is in the image.
          height: earnMode ? undefined : el.scrollHeight,
        },
      );
      setShot(where === "copied" ? "copied" : "saved");
      setTimeout(() => setShot("idle"), 2000);
    } catch (e) {
      console.warn("[econ-calendar] screenshot failed:", e);
      setShot("failed");
      setTimeout(() => setShot("idle"), 2500);
    } finally {
      if (sc && prevSc) { sc.style.overflowY = prevSc.overflowY; sc.style.height = prevSc.height; sc.style.flex = prevSc.flex; }
      el.style.height = prevEl.height;
      el.style.overflow = prevEl.overflow;
    }
  }, [shot, activeTab, earnWeek]);

  const shotLabel =
    shot === "working" ? "…"
    : shot === "copied" ? "✓ Copied"
    : shot === "saved"  ? "✓ Saved"
    : shot === "failed" ? "✕ Failed"
    : "⧉ Copy";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [econRes, qRes, earnRes] = await Promise.all([
        fetch("/api/calendar", { cache: "no-store" }),
        fetch("/api/calendar-quote", { cache: "no-store" }),
        // Both Mon–Fri weeks in one request — the board's week toggle is a
        // client-side filter, so flipping it costs nothing.
        fetch("/proxy/earnings-week?week=both", { cache: "no-store" }),
      ]);
      const econJson = await econRes.json();
      if (!econRes.ok) throw new Error(econJson?.error || `HTTP ${econRes.status}`);
      const list: CalEvent[] = Array.isArray(econJson?.events) ? econJson.events : Array.isArray(econJson) ? econJson : [];
      const sorted = list.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)
      );
      setEvents(sorted);
      setWarning(econJson?.warning ? String(econJson.warning) : null);
      setLastRefresh(new Date().toLocaleTimeString());
      if (qRes.ok) {
        const qj = await qRes.json();
        if (qj.quote) setQuote(qj.quote);
      }
      if (earnRes.ok) {
        const ej = await earnRes.json();
        setEarnings(Array.isArray(ej.rows) ? ej.rows : []);
      }
    } catch (e) { setError(String(e)); setEvents([]); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = etToday();

  // Earnings keyed by ET date → premarket / after-hours. "Time TBD" is dropped.
  // Memoised on `earnings`. This used to be a bare IIFE that rebuilt the whole
  // Map on EVERY render — including the once-a-minute `now` tick that exists
  // only to re-evaluate event staleness. So a page left open re-bucketed the
  // full earnings list 60 times an hour for a result that changes when the
  // fetch changes, which is once. Shared with the phone view via
  // lib/econCalendar so all three surfaces bucket identically.
  //
  // The market-cap floor is applied BEFORE bucketing, so a day left with no
  // qualifying names drops out of the Map entirely and its separator stops
  // rendering — rather than showing an empty PRE/AFTER strip.
  //
  // TWO derivations now, because the tabs want different things out of one feed:
  //
  //   earnByDate  — the CALENDAR tab, where earnings are woven between timed
  //                 econ events. Always the anticipated subset: the feed is the
  //                 whole Nasdaq calendar and a 400-chip block wedged between
  //                 two events is not a calendar.
  //   boardByDate — the EARNINGS tab's week board, which honours the week and
  //                 view toggles and is allowed to show everything.
  const capped = useCallback(
    (rows: EarnRow[]) => (mcapMin > 0 ? rows.filter(r => r.market_cap >= mcapMin) : rows),
    [mcapMin]
  );

  const earnByDate = useMemo(
    () => groupEarningsByDate(capped(pickAnticipated(earnings))),
    [earnings, capped]
  );

  // Mon–Fri of the selected week. etMonFri rolls weekends forward exactly like
  // the recorder's weekMonFri, so "this week" on a Saturday is the week that
  // starts Monday — the same week the server stored.
  const boardDays = useMemo(() => etMonFri(earnWeek), [earnWeek]);

  const boardByDate = useMemo(() => {
    const inWeek = earnings.filter(r => boardDays.includes(r.date));
    return groupEarningsByDate(
      capped(pickAnticipated(inWeek, earnView === "all" ? 0 : ANTICIPATED_PER_DAY))
    );
  }, [earnings, boardDays, earnView, capped]);

  // Names actually renderable at the current floor, for the dropdown label.
  // Counted off the bucketed Map for the tab in view, not off `earnings`, so it
  // matches what is on screen.
  const earnShown = useMemo(() => {
    let n = 0;
    for (const b of (activeTab === "earnings" ? boardByDate : earnByDate).values()) n += bucketCount(b);
    return n;
  }, [earnByDate, boardByDate, activeTab]);

  const mcapLabel = MCAP_OPTS.find(o => o.value === mcapMin)?.label ?? "All caps";

  function toggleFilter(key: FilterKey) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (key === "all") return new Set(["all"]);
      next.delete("all");
      if (next.has(key)) { next.delete(key); if (next.size === 0) next.add("all"); }
      else next.add(key);
      return next;
    });
  }

  const filtered = events.filter(ev =>
    passes(ev, activeFilters) &&
    (!search || ev.title?.toLowerCase().includes(search.toLowerCase()) || ev.country?.toLowerCase().includes(search.toLowerCase()))
  );

  const activeEvents = filtered.filter(e => !isStale(e, now));
  const staleEvents  = filtered.filter(e =>  isStale(e, now));

  const filterLabel = activeFilters.has("all")
    ? "ALL"
    : Array.from(activeFilters).map(k => FILTER_OPTS.find(o => o.value === k)?.label ?? k).join(" + ");

  const renderEvent = (ev: CalEvent, i: number, faded: boolean) => {
    const col = faded ? "#1e2a38" : impactColor(ev.impact);
    return (
      <div
        key={`${ev.date}-${ev.time}-${i}`}
        style={{
          display: "grid",
          gridTemplateColumns: "80px 1fr",
          borderTop: `1px solid ${HT.border}`,
          borderLeft: `3px solid ${col}`,
          background: faded ? HT.bg : `linear-gradient(90deg, ${col}0f 0%, transparent 35%), ${HT.bg}`,
          opacity: faded ? 0.32 : 1,
          transition: "opacity 0.4s",
          minHeight: 52,
        }}
      >
        <div style={{
          display: "flex", flexDirection: "column", justifyContent: "center",
          padding: "8px 12px",
          borderRight: `1px solid ${HT.border}`,
          boxShadow: faded ? "none" : `inset -1px 0 8px ${col}18`,
          gap: 2,
        }}>
          <span style={{ fontSize: 14, color: faded ? "#1e2a38" : HT.text, fontFamily: "var(--font-mono)" }}>
            {ev.time_formatted || ev.time || "TBD"}
          </span>
        </div>
        <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: col, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {ev.impact}
            </span>
            <span style={{ fontSize: 12, color: faded ? "#1e2a38" : HT.text, fontWeight: 600 }}>
              {ev.country}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: ev.impact === "High" ? 700 : 500, color: faded ? "#1e2a38" : HT.text, lineHeight: 1.3 }}>
            {ev.title}
          </div>
          {(ev.actual || ev.forecast || ev.previous) && (
            <div style={{ display: "flex", gap: 14, marginTop: 2 }}>
              {ev.actual   && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#22c55e", fontFamily: "var(--font-mono)" }}>A: <strong>{ev.actual}</strong></span>}
              {ev.forecast && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : "#f59e0b", fontFamily: "var(--font-mono)" }}>F: {ev.forecast}</span>}
              {/* White, not grey. A/F/P is already colour-coded green/amber and
                  the grey "previous" was the one body value on either tab that
                  read as disabled rather than as data. */}
              {ev.previous && <span style={{ fontSize: 12, color: faded ? "#1e2a38" : HT.text, fontFamily: "var(--font-mono)" }}>P: {ev.previous}</span>}
            </div>
          )}
        </div>
      </div>
    );
  };

  function renderWithDaySeparators(evList: CalEvent[], faded: boolean) {
    const result: React.ReactNode[] = [];
    const byDate = new Map<string, CalEvent[]>();
    evList.forEach(ev => {
      if (!byDate.has(ev.date)) byDate.set(ev.date, []);
      byDate.get(ev.date)!.push(ev);
    });

    let i = 0;
    for (const [date, evs] of byDate) {
      const isTod = date === today;
      result.push(
        <div
          key={`sep-${faded ? "s" : "a"}-${date}`}
          style={{
            padding: "6px 16px",
            background: isTod ? "rgba(33,158,188,0.06)" : HT.panelBg,
            borderTop: `1px solid ${HT.border}`,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {/* Day label is white on every day, today included — the cyan TODAY
              pill and the tinted row already mark today, and the old #3a5570
              made every other date read as disabled. */}
          <span style={{ fontSize: 12, fontWeight: 800, color: HT.text, letterSpacing: "0.1em" }}>
            {fullDayLabel(date, today)}
          </span>
          {isTod && (
            <span style={{ fontSize: 10, fontWeight: 900, background: HT.cyan, color: "#05080d", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.1em" }}>
              TODAY
            </span>
          )}
        </div>
      );

      const bucket = faded ? null : earnByDate.get(date);
      if (bucket?.pre.length) result.push(<EarnRowBlock key={`pre-${date}`} kind="pre" rows={bucket.pre} />);

      // After-hours slots in after the last event at/before 16:00.
      const afterIdx = evs.findIndex(e => (e.time || "00:00") > "16:00");
      evs.forEach((ev, k) => {
        if (bucket?.after.length && afterIdx >= 0 && k === afterIdx) {
          result.push(<EarnRowBlock key={`aft-${date}`} kind="after" rows={bucket.after} />);
        }
        result.push(renderEvent(ev, i++, faded));
      });
      if (bucket?.after.length && afterIdx < 0) {
        result.push(<EarnRowBlock key={`aft-${date}`} kind="after" rows={bucket.after} />);
      }
      // Unconfirmed-time names last — they have no position in the day's
      // sequence, so anchoring them anywhere earlier would imply one.
      if (bucket?.tbd.length) {
        result.push(<EarnRowBlock key={`tbd-${date}`} kind="tbd" rows={bucket.tbd} />);
      }
    }
    return result;
  }

  // Earnings-only view: every date that has pre/after/tbd earnings, in order,
  // with an optional ticker/company search — independent of the impact filters.
  // Driven by boardByDate, so the week and view toggles apply here and only
  // here; the calendar tab keeps its own anticipated-only derivation.
  const earningsDates = Array.from(boardByDate.keys()).sort();
  const q = search.trim().toLowerCase();
  function matchesQ(r: EarnRow) {
    if (!q) return true;
    return r.symbol.toLowerCase().includes(q) || (r.company || "").toLowerCase().includes(q);
  }
  const earningsSections = earningsDates
    .map(date => {
      const bucket = boardByDate.get(date)!;
      const pre = bucket.pre.filter(matchesQ);
      const after = bucket.after.filter(matchesQ);
      const tbd = bucket.tbd.filter(matchesQ);
      return { date, pre, after, tbd };
    })
    .filter(s => s.pre.length > 0 || s.after.length > 0 || s.tbd.length > 0);

  /**
   * Earnings tab — a WEEK BOARD, one column per trading day.
   *
   * The old layout was the calendar's own row grid: a full-width band per
   * session with a fixed 80px time gutter and the chips flowing left. A week
   * with four names on Tuesday spent a 2000px-wide row on four 46px chips, so
   * the tab was mostly empty background running down the right-hand side, and
   * the five days stacked into a page taller than the fold for ~25 names.
   *
   * Columns fix both halves of that: the width is divided between the days
   * instead of being handed to one row, and the whole week lands in one screen —
   * which is also what makes the tab worth pasting into a chat as a single
   * image.
   *
   * `auto-fit` (not repeat(5)) because the feed decides how many days come back,
   * and because globals.css's GLOBAL GRID COLLAPSE flattens fixed repeat(N)
   * counts on phones but deliberately re-exempts auto-fit/auto-fill.
   */
  function renderEarningsOnly() {
    if (earningsSections.length === 0) {
      // Name the reason. "No earnings match." reads as an empty feed, but the
      // usual cause is a cap floor the user set two clicks ago and forgot — or,
      // now, a week the recorder has not swept yet.
      const inWeek = earnings.filter(r => boardDays.includes(r.date)).length;
      const why = earnings.length === 0
        ? "No earnings loaded."
        : inWeek === 0
          ? `Nothing stored for ${dayDate(boardDays[0])}–${dayDate(boardDays[4])} yet.`
          : mcapMin > 0 && earnShown === 0
            ? `No earnings ${mcapLabel} this week — try a lower cap.`
            : "No earnings match.";
      return <div style={{ color: HT.text, fontSize: 14, padding: 20 }}>{why}</div>;
    }

    const first = earningsSections[0].date;
    const last  = earningsSections[earningsSections.length - 1].date;
    const shown = earningsSections.reduce((n, s) => n + s.pre.length + s.after.length + s.tbd.length, 0);

    return (
      <div ref={earnRef} style={{ background: HT.bg, padding: 12 }}>

        {/* Board header — lives INSIDE the capture target, so the copied image
            carries the mark and the week it covers without the app chrome. */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "10px 12px", marginBottom: 10,
          borderRadius: 12,
          border: `1px solid ${BOARD.edge}`,
          borderTop: `2px solid ${HT.cyan}`,
          background: BOARD.header,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: HT.text, letterSpacing: "0.14em" }}>
              {earnWeek === 0 ? "EARNINGS THIS WEEK" : "EARNINGS NEXT WEEK"}
            </span>
            <span style={{ fontSize: 11, color: HT.text, fontFamily: MONO, letterSpacing: "0.04em", lineHeight: 1.3 }}>
              {dayDate(first)} – {dayDate(last)}
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {/* PILL TEXT CENTERING — sized by PADDING, never by `height`.

                A fixed `height` + `line-height` is the CSS way to centre a badge
                and it is the wrong way here, because it hands the capture a
                number it has to reconcile against its own font metrics.
                snapshot.ts's `data-cap-center` does try: it swaps the declared
                height for `height:auto` and re-expresses the slack as padding.
                But the slack is `height − borders − font-size`, and if the clone
                measured the run in a DIFFERENT font from the one html2canvas
                paints with, that arithmetic lands on a box the glyphs do not fit
                — which is exactly what the last PNG showed, ANTICIPATED sitting
                low and overflowing its own pill.

                Padding sizing removes the arithmetic. The box is text + 5px + 5px
                by construction, so it is centred on the live page whatever the
                font does, and `data-cap-center` falls to its no-height branch,
                which only RE-SPLITS the padding by the measured drawing error and
                cannot change the box. `MONO` names real families so the clone and
                the painter agree on the metrics in the first place.

                `text-align:center` because the pass rewrites inline-flex to
                inline-block on the clone, and flex was the only thing centring
                these across. */}
            <span data-cap-center style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              textAlign: "center", lineHeight: 1,
              fontSize: 11, fontWeight: 800, fontFamily: MONO,
              color: HT.cyan, background: `${HT.cyan}1A`, border: `1px solid ${HT.cyan}55`,
              padding: "5px 10px", borderRadius: 999, letterSpacing: "0.06em",
            }}>
              {shown} NAMES
            </span>
            {/* Both of these are captured into the copied PNG on purpose: a
                board pasted into a chat has to say what it is a board OF, or
                "14 names on Wednesday" reads as the whole day's calendar. */}
            <span data-cap-center style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              textAlign: "center", lineHeight: 1,
              fontSize: 11, fontWeight: 700, fontFamily: MONO,
              color: HT.text, border: `1px solid ${BOARD.edge}`,
              padding: "5px 10px", borderRadius: 999,
            }}>
              {earnView === "all" ? "ALL NAMES" : "ANTICIPATED"}
            </span>
            {mcapMin > 0 && (
              <span data-cap-center style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                textAlign: "center", lineHeight: 1,
                fontSize: 11, fontWeight: 700, fontFamily: MONO,
                color: HT.text, border: `1px solid ${BOARD.edge}`,
                padding: "5px 10px", borderRadius: 999,
              }}>
                {mcapLabel}
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 800, color: HT.text, fontFamily: MONO, lineHeight: 1 }}>
              cbedge.net
            </span>
          </div>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 10,
          alignItems: "start",
        }}>
          {earningsSections.map(s => (
            <EarnDayColumn
              key={`earn-col-${s.date}`}
              date={s.date}
              isToday={s.date === today}
              pre={s.pre}
              after={s.after}
              tbd={s.tbd}
            />
          ))}
        </div>

        {/* Signature. Bottom-right, under the grid rather than beside the title:
            the header's left edge is the week's own label, and a mark there was
            competing with it. Down here it reads as the source of the board,
            which is what it is once the image is pasted somewhere else. Inside
            earnRef, so the capture carries it. */}
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 10 }}>
          {/* Same-origin file in public/ — a real image the capture can draw,
              unlike the 302'd ticker logos. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 26, width: "auto", display: "block" }} />
        </div>
      </div>
    );
  }

  return (
    <div ref={shotRef} style={{ ...homeShellStyle, height: "100%" }}>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", background: HT.panelBgStrong, backdropFilter: "blur(16px)",
        borderBottom: `1px solid ${HT.border}`, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 20, width: "auto", display: "block", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: HT.text }}>
            Economic Calendar
          </span>
          {lastRefresh && (
            <span style={{ fontSize: 12, color: HT.text, fontFamily: "var(--font-mono)", background: HT.panelBg, padding: "2px 8px", borderRadius: 3 }}>
              {today}
            </span>
          )}

          {/* Tabs: full calendar vs earnings-only */}
          <div style={{ display: "flex", gap: 4, background: HT.panelBg, borderRadius: 6, padding: 3, border: `1px solid ${HT.border}` }}>
            {(["calendar", "earnings"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "5px 12px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: activeTab === t ? HT.cyan : "transparent",
                  color: activeTab === t ? "#05080d" : HT.text,
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {t === "calendar" ? "Calendar" : "Earnings"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Multi-select dropdown — only meaningful on the calendar tab */}
          {activeTab === "calendar" && (
          <div ref={dropRef} style={{ position: "relative" }}>
            <button onClick={() => setDropOpen(o => !o)} style={{ ...homeButtonStyle, display: "flex", alignItems: "center", gap: 6 }}>
              {filterLabel} <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {dropOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 200,
                background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
                border: `1px solid ${HT.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`, borderRadius: 14,
                padding: 6, minWidth: 180, boxShadow: DOCK_THEME.shadow,
              }}>
                {FILTER_OPTS.map(o => {
                  const on = activeFilters.has(o.value);
                  return (
                    <div
                      key={o.value}
                      onClick={() => toggleFilter(o.value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px", cursor: "pointer", borderRadius: 8,
                        background: on ? DOCK_THEME.activeTile : "transparent",
                        border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                      }}
                      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `2px solid ${o.color}`,
                        background: on ? o.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, color: "#05080d", fontWeight: 900,
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: on ? HT.cyan : HT.text }}>
                        {o.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Week + breadth, earnings tab only. The feed already holds both
              weeks, so these are filters over rows in hand — no refetch, no
              spinner, and the Copy button captures whatever is showing. */}
          {activeTab === "earnings" && (
            <>
              <div style={{ display: "flex", gap: 3, background: HT.panelBg, borderRadius: 6, padding: 3, border: `1px solid ${HT.border}` }}>
                {([0, 1] as const).map(w => (
                  <button
                    key={w}
                    onClick={() => setEarnWeek(w)}
                    title={`${dayDate(etMonFri(w)[0])} – ${dayDate(etMonFri(w)[4])}`}
                    style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
                      padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                      background: earnWeek === w ? HT.cyan : "transparent",
                      color: earnWeek === w ? "#05080d" : HT.text,
                    }}
                  >
                    {w === 0 ? "This wk" : "Next wk"}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 3, background: HT.panelBg, borderRadius: 6, padding: 3, border: `1px solid ${HT.border}` }}>
                {VIEW_OPTS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setEarnView(o.value)}
                    title={o.hint}
                    style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
                      padding: "5px 10px", borderRadius: 4, border: "none", cursor: "pointer",
                      background: earnView === o.value ? HT.cyan : "transparent",
                      color: earnView === o.value ? "#05080d" : HT.text,
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Earnings market-cap floor. Shown on BOTH tabs: the calendar tab
              weaves the same earnings rows in between events, so the floor has
              to be reachable there too or the chips can only be thinned from a
              tab the user is not on. Single-select. */}
          <div ref={capRef} style={{ position: "relative" }}>
            <button
              onClick={() => setCapOpen(o => !o)}
              title="Minimum market cap for earnings names"
              style={{ ...homeButtonStyle, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ color: HT.cyan, fontWeight: 800, letterSpacing: "0.06em" }}>MCAP</span>
              {mcapLabel}
              <span style={{ fontSize: 10, color: "#3a5570", fontFamily: "var(--font-mono)" }}>{earnShown}</span>
              <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {capOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 200,
                background: DOCK_THEME.bg, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
                border: `1px solid ${HT.border}`, borderTop: `2px solid ${DOCK_THEME.cyanTop}`, borderRadius: 14,
                padding: 6, minWidth: 170, boxShadow: DOCK_THEME.shadow,
              }}>
                {MCAP_OPTS.map(o => {
                  const on = o.value === mcapMin;
                  return (
                    <div
                      key={o.value}
                      onClick={() => { setMcapMin(o.value); setCapOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px", cursor: "pointer", borderRadius: 8,
                        background: on ? DOCK_THEME.activeTile : "transparent",
                        border: on ? `1px solid ${DOCK_THEME.activeBorder}` : "1px solid transparent",
                      }}
                      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = DOCK_THEME.hoverTile; }}
                      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                        border: `2px solid ${HT.cyan}`,
                        background: on ? HT.cyan : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#05080d", fontWeight: 900,
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: on ? HT.cyan : HT.text }}>
                        {o.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <input
            type="text" placeholder={activeTab === "earnings" ? "Search ticker…" : "Search…"} value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: "4px 10px", background: "rgba(0,0,0,0.4)", border: `1px solid ${HT.border}`, color: HT.text, outline: "none", borderRadius: 3, width: 140 }}
          />
          <button
            onClick={takeShot}
            disabled={shot === "working"}
            title={activeTab === "earnings"
              ? "Copy the earnings week board to the clipboard"
              : "Copy the full calendar to the clipboard"}
            // The page capture includes this toolbar, so without this the PNG
            // shows the button frozen mid-click on "…". Dropped from the clone
            // only. (The earnings capture targets the board, which excludes it
            // outright — this still matters for the calendar tab.)
            data-noshot="1"
            style={{
              ...homeButtonStyle,
              color: shot === "failed" ? HT.red : shot === "copied" || shot === "saved" ? HT.cyan : undefined,
              borderColor: shot === "failed" ? HT.red : shot === "copied" || shot === "saved" ? HT.cyan : undefined,
            }}
          >
            {shotLabel}
          </button>
          <button onClick={load} disabled={loading} data-noshot="1" style={{ ...homeButtonStyle }}>
            {loading ? "…" : "↻ Now"}
          </button>
        </div>
      </div>

      {/* Quote */}
      {activeTab === "calendar" && quote && (
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${HT.border}`, background: HT.panelBgStrong, backdropFilter: "blur(16px)", flexShrink: 0, textAlign: "center" }}>
          <span style={{ fontSize: 14, fontStyle: "italic", color: HT.text, lineHeight: 1.7 }}>
            &ldquo;{quote}&rdquo;
          </span>
        </div>
      )}

      {/* Feed-health warning — OWNER ONLY (see isOwner above). This is the banner
          that was showing raw upstream text to customers. The hardcoded "showing
          saved events" prefix is gone too: it was wrong whenever the source was
          the cache rather than events.json, and `warning` already says which. */}
      {activeTab === "calendar" && isOwner && warning && !error && (
        <div style={{ padding: "6px 16px", fontSize: 12, color: "#f59e0b", background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.25)", flexShrink: 0 }}>
          ⚠ {warning}
        </div>
      )}

      {/* Event / earnings list */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        {activeTab === "earnings" ? (
          loading && earnings.length === 0 ? (
            <div style={{ color: HT.text, fontSize: 14, textAlign: "center", marginTop: 60 }}>Loading…</div>
          ) : (
            renderEarningsOnly()
          )
        ) : error && isOwner ? (
          // Raw fetch error, owner only. Customers fall through to the neutral
          // empty-state line below rather than seeing upstream status text.
          <div style={{ fontSize: 14, color: HT.red, padding: 16, margin: 16, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 4, background: "rgba(239,68,68,0.05)" }}>
            ⚠ {error}
          </div>
        ) : loading && events.length === 0 ? (
          <div style={{ color: HT.text, fontSize: 14, textAlign: "center", marginTop: 60 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: HT.text, fontSize: 14, padding: 20 }}>No events match.</div>
        ) : (
          <>
            {renderWithDaySeparators(activeEvents, false)}
            {staleEvents.length > 0 && (
              <>
                {activeEvents.length > 0 && <div style={{ height: 1, background: HT.border, margin: "2px 0" }} />}
                {renderWithDaySeparators(staleEvents, true)}
              </>
            )}
          </>
        )}
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Earnings WEEK BOARD (the earnings tab). The calendar tab keeps EarnRowBlock
// below — there the earnings have to interleave with timed econ events, so they
// must stay in that table's row grid.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One ticker tile: LOGO, then TICKER. Nothing else.
 *
 * The market cap line is gone. It was the same number three times over — the
 * board is already ordered by cap, the chips are already picked by it, and
 * "5B" under a mark nobody was reading it against told you nothing you could
 * act on. It cost a third line on every tile, which is what made a nine-name
 * Wednesday taller than the fold. Cap and EPS estimate are still one hover away
 * in `title`, which is where a per-name detail belongs on a board this dense.
 *
 * Everything inside is centered on the cell's axis. `textAlign:center` +
 * `width:100%` on the label is what actually does it: align-items only centers
 * the SPAN, not the text inside a span that stretches to the column.
 */
function EarnChip({ row }: { row: EarnRow }) {
  return (
    <a
      href={`https://finance.yahoo.com/quote/${row.symbol}`}
      target="_blank"
      rel="noreferrer"
      title={`${row.company || row.symbol} · ${fmtMcap(row.market_cap)}${row.eps_est ? ` · est ${row.eps_est}` : ""}`}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
        gap: 6, minWidth: 0, padding: "7px 3px", textDecoration: "none",
        borderRadius: 9,
        background: BOARD.tile,
        border: `1px solid ${BOARD.rule}`,
      }}
    >
      {/* lazy={false}: this board is the screenshot target, and html2canvas
          clones the DOM as it stands — a chip the browser has not fetched yet
          captures empty. */}
      <ChipLogo sym={row.symbol} company={row.company} size={CHIP_LOGO} radius={10} lazy={false} />
      <span style={{
        width: "100%", textAlign: "center", lineHeight: 1,
        fontSize: 11, fontWeight: 800, color: HT.text,
        fontFamily: MONO, letterSpacing: "0.02em",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {row.symbol}
      </span>
    </a>
  );
}

/** PRE / AFTER / TBD block inside a day column. */
function EarnSession({ kind, rows }: { kind: EarnKind; rows: EarnRow[] }) {
  const k = EARN_KIND[kind];
  return (
    <div style={{ padding: "8px 9px 10px", borderTop: `1px solid ${BOARD.rule}` }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
        {/* The dot lives INSIDE the label, not beside it.

            As a flex sibling it was centred on the ROW, and the row's height is
            set by the tallest line box — so the 6px dot sat on the line's middle
            while the 9px all-caps label's own cap band sits above that, which is
            the "dot not aligned with the font" in the report. Nested in a
            `line-height:1` inline-block it is baseline-aligned instead: with no
            leading, a 6px square whose bottom rests on the baseline centres to
            within a third of a pixel of the cap band. Same trick the day header
            above uses, one level down.

            `data-cap-swatch` + `data-cap-center` carry it into the PNG:
            html2canvas draws the run lower than the browser does, and
            alignCapSwatches re-pins anything marked as a swatch onto the cap
            band it actually painted (snapshot.ts gotcha 10b). The wrapper is an
            inline-block, so the engine's flex→inline-block rewrite is a no-op
            and the row's `margin-left:auto` count is untouched. */}
        <span
          data-cap-center
          style={{
            display: "inline-block", lineHeight: 1,
            fontSize: 9, fontWeight: 900, color: k.color,
            textTransform: "uppercase", letterSpacing: "0.12em",
          }}
        >
          <span
            data-cap-swatch
            style={{
              display: "inline-block", width: 6, height: 6, borderRadius: "50%",
              background: k.color, marginRight: 6,
            }}
          />
          {k.board}
        </span>
        <span style={{
          marginLeft: "auto", fontSize: 9, color: HT.text, fontWeight: 700,
          fontFamily: MONO, lineHeight: 1, opacity: 0.6,
        }}>
          {rows.length}
        </span>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${CHIP_MIN}px, 1fr))`,
        gap: 8,
      }}>
        {rows.map(r => <EarnChip key={r.symbol} row={r} />)}
      </div>
    </div>
  );
}

/** One day of the week board. */
function EarnDayColumn({
  date, isToday, pre, after, tbd,
}: { date: string; isToday: boolean; pre: EarnRow[]; after: EarnRow[]; tbd: EarnRow[] }) {
  const n = pre.length + after.length + tbd.length;
  return (
    <div style={{
      display: "flex", flexDirection: "column", minWidth: 0,
      borderRadius: 12, overflow: "hidden",
      border: `1px solid ${isToday ? BOARD.edgeToday : BOARD.edge}`,
      background: isToday ? BOARD.cardToday : BOARD.card,
    }}>
      {/* Day header.

          THREE-COLUMN GRID, not a flex row, because the date has to sit in the
          MIDDLE of the strip. A flex row with the count pushed right by
          margin-left:auto centres nothing — the date lands wherever the count's
          width leaves it, so a column showing "11" put its date a few px left of
          a column showing "1". The outer tracks are equal `1fr`, so the middle
          track's centre is the strip's centre no matter what either side holds.

          The date is WHITE on every day — the cyan weekday and the TODAY pill
          already carry the emphasis, and the old #3a5570 made every day that was
          not today read as a disabled row. */}
      <div
        // SYMMETRIC padding, `data-cap-center`, and — the part that actually
        // squares the weekday with the date — ONE FONT SIZE AND ONE FAMILY for
        // every run in the strip.
        //
        // They used to be 10px mono and 13px sans. On the live page
        // `align-items:center` reconciles that; in the PNG nothing does.
        // html2canvas paints each run at `rect.top + baseline`, and `baseline`
        // is a per-font, per-SIZE probe — so two runs of different sizes get two
        // different drops and separate by a px or more, which is MONDAY riding
        // above AUG 31 in the report. A box-level fix cannot reach it: the tag
        // below re-splits the strip's own padding, moving both runs together.
        // Making them the same size and family makes the two drops identical, so
        // they cannot drift apart at all — the contrast between them is carried
        // by weight and colour instead, which the capture reproduces exactly.
        data-cap-center
        style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          padding: "9px 10px",
          background: isToday ? BOARD.headToday : BOARD.head,
        }}
      >
        <span />
        <span style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center" }}>
          <span style={{
            fontSize: 12, fontWeight: 900, color: HT.cyan, lineHeight: 1,
            letterSpacing: "0.1em", fontFamily: MONO,
          }}>
            {dayFull(date)}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 800, color: HT.text, lineHeight: 1,
            letterSpacing: "0.04em", fontFamily: MONO,
          }}>
            {dayDate(date)}
          </span>
          {isToday && (
            <span style={{
              fontSize: 10, fontWeight: 900, background: HT.cyan, color: "#05080d",
              fontFamily: MONO, padding: "3px 5px", borderRadius: 3,
              letterSpacing: "0.1em", lineHeight: 1,
            }}>
              TODAY
            </span>
          )}
        </span>
        {/* Same 12px mono for the same reason — a 10px run here would sit on
            its own baseline and read as a half-line above the date. */}
        <span style={{
          justifySelf: "end", fontSize: 12, color: HT.text, fontWeight: 700,
          fontFamily: MONO, lineHeight: 1, opacity: 0.6,
        }}>
          {n}
        </span>
      </div>

      {pre.length   > 0 && <EarnSession kind="pre"   rows={pre} />}
      {after.length > 0 && <EarnSession kind="after" rows={after} />}
      {tbd.length   > 0 && <EarnSession kind="tbd"   rows={tbd} />}
    </div>
  );
}

// One earnings row woven into the calendar table — same grid as an event row.
// "tbd" is the unconfirmed-time bucket: same layout, deliberately desaturated
// so it never reads as a confirmed premarket/after-hours slot at a glance.
type EarnKind = "pre" | "after" | "tbd";

// `board` is the week-board's session label — shorter than `title` because it
// sits in a ~200px column, and colored per session so PRE and AFTER are
// distinguishable at a glance (they used to share one cyan).
const EARN_KIND: Record<EarnKind, { top: string; sub: string; title: string; board: string; color: string }> = {
  pre:   { top: "PRE",   sub: "MARKET", title: "Premarket earnings",   board: "Premarket",    color: HT.cyan },
  after: { top: "AFTER", sub: "HOURS",  title: "After-hours earnings", board: "After hours",  color: HT.orange },
  tbd:   { top: "TIME",  sub: "TBD",    title: "Time unconfirmed",     board: "Time unconfirmed", color: HT.text },
};

function EarnRowBlock({ kind, rows }: { kind: EarnKind; rows: EarnRow[] }) {
  const k = EARN_KIND[kind];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "80px 1fr",
      borderTop: `1px solid ${HT.border}`,
      borderLeft: `3px solid ${k.color}`,
      background: `linear-gradient(90deg, ${k.color}12 0%, transparent 40%), ${HT.bg}`,
      minHeight: 52,
    }}>
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "8px 12px",
        borderRight: `1px solid ${HT.border}`,
        boxShadow: `inset -1px 0 8px ${k.color}18`,
      }}>
        <span style={{ fontSize: 12, color: k.color, fontFamily: "var(--font-mono)", fontWeight: 800, lineHeight: 1.25 }}>
          {k.top}
        </span>
        <span style={{ fontSize: 10, color: "#3a5570", fontFamily: "var(--font-mono)" }}>
          {k.sub}
        </span>
      </div>

      <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: k.color, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {k.title}
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: CHIP_GAP }}>
          {rows.map((e) => (
            <a
              key={e.symbol}
              href={`https://finance.yahoo.com/quote/${e.symbol}`}
              target="_blank"
              rel="noreferrer"
              title={`${e.company || e.symbol} · ${fmtMcap(e.market_cap)}${e.eps_est ? ` · est ${e.eps_est}` : ""}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, width: CHIP_W, textDecoration: "none" }}
            >
              <ChipLogo sym={e.symbol} company={e.company} size={34} radius={8} />
              <span style={{ fontSize: 10, fontWeight: 700, color: HT.text, fontFamily: "var(--font-mono)", letterSpacing: "0.02em", maxWidth: CHIP_W, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.symbol}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
