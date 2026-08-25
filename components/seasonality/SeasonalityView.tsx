"use client";

// ─────────────────────────────────────────────────────────────────────────────
// S&P 500 seasonality — the shell: a section rail plus one pane.
//
// This used to be one very long scroll of fourteen cards. It is now a rail on
// the left and ONE section in the pane, because the studies here answer
// different questions and stacking them made every one of them harder to find.
// The rail doubles as a table of contents — you can see the whole shape of the
// tool without scrolling it.
//
// ONE SECTION IS MOUNTED AT A TIME. Unmounted, not hidden: a display toggle
// would keep every chart's SVG and ResizeObserver alive for a reader looking at
// one of them. That is also why the width hooks here and in the almanac use
// CALLBACK refs — see useMeasuredWidth's comment there. A useEffect([]) would
// attach to the first node only, and every chart after the first navigation
// would render blank at width 0.
//
// DEEP LINKS: each section owns a hash (/explore/seasonality#vix-spike). First
// paint always starts from DEFAULT_SECTION, a constant; the hash is read in an
// effect AFTER hydration and written with replaceState, so Back leaves the page
// instead of walking the rail. Same rule app/test/page.tsx follows.
//
// Mounted in TWO places and it must keep working in both:
//   • Test Lab → Seasonality (/app/test#seasonality), signed in.
//   • /explore/seasonality, the PUBLIC free-tool page, signed OUT.
// That is why it lives in components/ and not in app/test/, and why it reads no
// session, no cookie and nothing from the API — a component that quietly needs
// an auth context renders empty for exactly the visitors the public page exists
// to convert, and nothing in the signed-in view would ever show it.
//
// Two lines on one calendar-day axis:
//   • the average cumulative % path of the S&P 500 across a selectable window
//     (10 / 20 / 50 years, or the whole 1928-2025 record) — the "seasonal" curve,
//     same construction as the published EquityClock chart, and
//   • 2026 so far, re-based to the same 31-Dec-2025 close.
//
// The point of putting them on one axis is the SPREAD: how far ahead of, or
// behind, its own seasonal script this year is running. That number is the
// headline tile, not the two levels.
//
// BASIS. Everything here is the SPX CASH INDEX (Yahoo ^GSPC), price return
// only. It used to be a back-adjusted ES continuous series over eight years, which meant
// the seasonal curve and the price axis were on a contract that does not exist
// as a level — and back-adjustment damps the percentage swings of older years.
// Cash removes both problems and buys 90 more years of sample. It also means the
// right-hand price axis is now a real index level you can compare to a quote.
//
// TWO AXES, ONE SCALE. The left axis and the right axis are the SAME axis in two
// units — right = YTD_BASE_PX × (1 + left/100). Both are drawn off the same tick
// positions, so the index level on the right is always the literal level that
// corresponds to the % on the left. That is the only honest way to overlay this
// year's LEVEL on a seasonal % curve: an independently auto-scaled second axis
// would let the two lines cross wherever the scaling happened to put them and
// the crossings would mean nothing.
//
// The mode toggle only picks which unit is primary — % on the left with the
// index on the right, or the index on the left with % on the right. The lines do
// not move between modes; only the labels swap.
//
// Everything is drawn as hand-rolled SVG. No chart dependency, no canvas, and no
// color that is not from HOME_THEME.
//
// HYDRATION: chart width starts at 0 on BOTH sides and is filled in by a
// ResizeObserver after mount, so the server and the first client paint agree.
// The selected baseline also starts from a CONSTANT for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import SeasonalityAlmanac from "./SeasonalityAlmanac";
import {
  DEFAULT_SECTION,
  SECTION_GROUPS,
  hashForSection,
  sectionForHash,
  type SectionKey,
} from "./sections";
import { SeaCard } from "./Watermark";
import { SEA } from "./seaTheme";
import {
  ALMANAC,
  DEFAULT_BASELINE,
  OVERLAY_YEARS,
  SEASONAL_BASELINES,
  SEASONAL_YEAR_RETURNS,
  YEAR_META,
  YTD_2026_PCT,
  YTD_2026_PX,
  YTD_BASE_PX,
  YTD_LAST_DATE,
  yearCurve,
} from "./seasonalityData";

type Mode = "pct" | "price";

const SEASON_COLOR = HOME_THEME.green;   // #8ECAE6 — the average, the backdrop
const YEAR_COLOR = HOME_THEME.orange;    // #FB8501 — this year, the subject
const INK = HOME_THEME.text;             // #FFFFFF — the only text color here

/**
 * Overlay slots for comparison years. FOUR, and not one more.
 *
 * With the seasonal average and the live year already on the chart, six lines
 * is the ceiling at which hues stay separable — the palette validator's
 * normal-vision floor fails past that, and that check is not one you can buy
 * your way out of with a legend. So each overlay carries THREE encodings, not
 * one: its hue, its dash pattern, and a year label printed at the end of its
 * own line. A colorblind reader, a greyscale print and a screenshot all still
 * resolve which line is which.
 *
 * If you ever want a fifth: facet the chart, don't add a hue.
 */
const OVERLAY_SLOTS: { color: string; dash: string }[] = [
  { color: "#8b6fe0", dash: "" },
  { color: "#3fa06a", dash: "7 4" },
  { color: "#c95f8f", dash: "2 4" },
  { color: "#2b93c9", dash: "11 4 2 4" },
];
const MAX_OVERLAYS = OVERLAY_SLOTS.length;

/** The live year, taken from the data rather than typed in twice. */
const LIVE_YEAR = Number(YTD_LAST_DATE.slice(0, 4));

// ─────────────────────────────────────────────────────────────────────────────
// Election-cycle averages.
//
// An overlay is normally ONE year. These four are averages across every year
// sitting in the same slot of the four-year political cycle — the thing people
// actually mean when they ask "what does a midterm year look like".
//
// The cycle slot is `year % 4`, and the mapping is off by one from what you'd
// guess: the election happens in the year divisible by 4 (1928, 2024), and the
// FIRST year of the resulting term is the year after it. So mod 1 is
// post-election, mod 2 is midterm, mod 3 is pre-election, mod 0 is the election
// year itself. Sanity check: the group sizes this produces (25/24/24/25) match
// ALMANAC.presidential.n exactly — if a future data regen breaks that, this
// mapping is what to look at first.
// ─────────────────────────────────────────────────────────────────────────────
type CycleDef = {
  /** Overlay id. Namespaced so it can never collide with a year id. */
  id: string;
  /** Chip + hover-readout name. */
  label: string;
  /** End-of-line label on the chart. Must stay short — it lives in a ~76px gutter. */
  short: string;
  /** year % 4 */
  mod: number;
  /** Row in ALMANAC.presidential this cycle corresponds to. */
  row: number;
};

// Order here is display order, and it is not the cycle's own order on purpose:
// midterm and election are what people came for, so they lead.
// `row` indexes ALMANAC.presidential.index, which is ["1 Post-election",
// "2 Midterm", "3 Pre-election", "4 Election"] — the full-year averages in the
// chip tooltips are READ from there rather than retyped, so a data regen can
// never leave the tooltip disagreeing with the Presidential Cycle card.
const CYCLE_DEFS: CycleDef[] = [
  { id: "cycle:2", label: "Midterm years", short: "Midterm", mod: 2, row: 1 },
  { id: "cycle:0", label: "Election years", short: "Election", mod: 0, row: 3 },
  { id: "cycle:1", label: "Post-election years", short: "Post-elec", mod: 1, row: 0 },
  { id: "cycle:3", label: "Pre-election years", short: "Pre-elec", mod: 3, row: 2 },
];

/** Years that go into a cycle average: full 365-point curves only. */
function cycleYears(mod: number): number[] {
  return OVERLAY_YEARS.filter((y) => {
    if (y % 4 !== mod) return false;
    // The live year is a PARTIAL curve (it stops at today). Averaging it in
    // would drag the tail of the average toward zero for no reason and quietly
    // change the shape of the very line the visitor is comparing against.
    if (y === LIVE_YEAR) return false;
    return (yearCurve(y)?.length ?? 0) === N;
  });
}

/** Averaged cycle curves, computed once each on first use and cached. */
const cycleCache = new Map<number, { curve: number[]; years: number[] }>();
function cycleCurve(mod: number): { curve: number[]; years: number[] } {
  const hit = cycleCache.get(mod);
  if (hit) return hit;
  const years = cycleYears(mod);
  const out = new Array<number>(N).fill(0);
  for (const yr of years) {
    const c = yearCurve(yr)!;
    for (let i = 0; i < N; i++) out[i] += c[i];
  }
  for (let i = 0; i < N; i++) out[i] = years.length ? out[i] / years.length : 0;
  const val = { curve: out, years };
  cycleCache.set(mod, val);
  return val;
}

// Day-of-year index (0-based) of the 1st of each month, non-leap. 2026 is not a
// leap year, so this doubles as the calendar map for the live series.
const MONTHS = [
  { label: "Jan", day: 0 },
  { label: "Feb", day: 31 },
  { label: "Mar", day: 59 },
  { label: "Apr", day: 90 },
  { label: "May", day: 120 },
  { label: "Jun", day: 151 },
  { label: "Jul", day: 181 },
  { label: "Aug", day: 212 },
  { label: "Sep", day: 243 },
  { label: "Oct", day: 273 },
  { label: "Nov", day: 304 },
  { label: "Dec", day: 334 },
];

const N = 365;                          // calendar days on the axis
const LIVE = YTD_2026_PCT.length;       // days of 2026 we actually have

// right gutter holds the second-unit axis labels. Overlay year labels need a
// second column out there or they land on top of the price ticks, so the
// gutter widens when any overlay is on. See RIGHT_GUTTER_WIDE.
const PAD = { top: 18, right: 82, bottom: 30, left: 62 };
const RIGHT_GUTTER_WIDE = 132;
const YEAR_LABEL_DX = 56;
const CHART_H = 430;

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtPx = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The two units of the one axis. Right = base × (1 + left/100), and back. */
const pctToPx = (p: number) => YTD_BASE_PX * (1 + p / 100);
const pxToPct = (v: number) => (v / YTD_BASE_PX - 1) * 100;

function dayLabel(idx: number) {
  const d = new Date(Date.UTC(2026, 0, idx + 1));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Nice" axis ticks — at most `count`, on a 1/2/2.5/5 × 10ⁿ step. */
function niceTicks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm > 5 ? 10 : norm > 2.5 ? 5 : norm > 2 ? 2.5 : norm > 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) {
    out.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  }
  return out;
}

function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 140,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${HOME_THEME.border}`,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: INK,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
          color: color ?? HOME_THEME.text,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 11.5, color: INK, marginTop: 3 }}>{sub}</div>
      ) : null}
    </div>
  );
}

/**
 * Shell CSS lives here rather than in globals.css.
 *
 * The rail needs a media query (it becomes a horizontal strip on a phone) and
 * :hover / :focus-visible states, none of which inline styles can express. The
 * alternative was reaching into the shared globals.css for a component only two
 * routes mount — that file is already carrying a "GLOBAL GRID COLLAPSE" block
 * added for one page's benefit, and this would be the next one. Prefixed
 * `sea-` so it cannot collide with anything.
 *
 * Colors are read from HOME_THEME at module scope, not hardcoded.
 */
const SHELL_CSS = `
.sea-shell{display:grid;grid-template-columns:225px minmax(0,1fr);gap:16px;min-width:0;
  background:${SEA.shell};border:1px solid ${SEA.lineSoft};border-radius:16px;padding:12px}
.sea-pane{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;min-width:0}
.sea-rail{position:sticky;top:12px;align-self:start;min-width:0;
  border:1px solid ${SEA.lineSoft};border-radius:12px;background:${SEA.rail};
  padding:8px;max-height:calc(100vh - 40px);overflow:auto}
.sea-railgrp{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  color:${HOME_THEME.green};padding:10px 10px 4px}
.sea-railitem{display:block;width:100%;text-align:left;padding:7px 10px;border-radius:8px;
  border:1px solid transparent;background:transparent;color:${HOME_THEME.text};
  font:inherit;font-size:12px;font-weight:600;cursor:pointer;line-height:1.3}
.sea-railitem:hover{background:${SEA.cardHi}}
.sea-railitem:focus-visible{outline:2px solid ${HOME_THEME.cyan};outline-offset:2px}
.sea-railitem[aria-current="true"]{font-weight:800;color:${HOME_THEME.cyan};
  border-color:rgba(33,158,188,.4);
  background:linear-gradient(90deg,rgba(33,158,188,.26),rgba(33,158,188,.04))}
.sea-compare{border:1px solid ${HOME_THEME.cyan}66;
  background:linear-gradient(180deg,${HOME_THEME.cyan}1F,${SEA.card2});transition:border-color .15s}
.sea-compare:hover{border-color:${HOME_THEME.cyan}}
.sea-compare summary:focus-visible{outline:2px solid ${HOME_THEME.cyan};outline-offset:2px;border-radius:12px}
.sea-caret{color:${HOME_THEME.cyan};font-size:11px;display:inline-block;transition:transform .15s}
.sea-compare[open] .sea-caret{transform:rotate(90deg)}
.sea-comparecta{margin-left:auto;flex:none;padding:5px 12px;border-radius:999px;
  background:${HOME_THEME.cyan};color:#04121a;font-size:11px;font-weight:800;letter-spacing:.06em;
  text-transform:uppercase;white-space:nowrap}
.sea-compare[open] .sea-comparecta{display:none}
/* Disclosure caret inside the almanac cards (SeasonalityAlmanac's Collapse).
   It lives here, not there, because that component ships no stylesheet and a
   :not-open selector cannot be expressed inline. */
.sea-disccaret{transition:transform .15s ease}
.sea-disc[open] > summary .sea-disccaret{transform:rotate(90deg)}
@media (max-width:860px){
  /* Rail becomes a horizontally scrollable strip above the pane. It stays a
     single <nav> of the same buttons — no duplicate markup, so there is no
     second copy to keep in sync and nothing hidden from a screen reader. */
  .sea-shell{grid-template-columns:minmax(0,1fr)}
  .sea-rail{position:static;max-height:none;display:flex;gap:6px;overflow-x:auto;
    padding:8px;scrollbar-width:thin}
  .sea-rail>div{display:flex;gap:6px;align-items:center;flex:none}
  .sea-railgrp{padding:0 4px 0 8px;white-space:nowrap;align-self:center;font-size:8.5px}
  .sea-railitem{width:auto;white-space:nowrap;border:1px solid ${SEA.line}}
}
`;

export default function SeasonalityView() {
  const [mode, setMode] = useState<Mode>("pct");
  const [baselineKey, setBaselineKey] = useState<string>(DEFAULT_BASELINE);
  // Overlay years start EMPTY, from a constant — never seeded from the URL or
  // localStorage. Seeding client-only state is how this page would render one
  // set of lines on the server and another on the client (React #418).
  // Ids, not years: an overlay is either a single year ("2008") or one of the
  // four election-cycle averages ("cycle:2"). One ordered list, because slot
  // colors are assigned by position — two parallel lists would let a year and a
  // cycle claim the same hue.
  const [overlays, setOverlays] = useState<string[]>([]);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  // Callback ref, not useRef + useEffect([]) — the chart unmounts whenever the
  // rail moves to another section, and an empty-dep effect would only ever
  // observe the first node. See useMeasuredWidth in SeasonalityAlmanac.
  const roRef = useRef<ResizeObserver | null>(null);
  const wrapRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(node);
    roRef.current = ro;
    setWidth(node.clientWidth);
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  // ── section routing ──────────────────────────────────────────────────────
  const [active, setActive] = useState<SectionKey>(DEFAULT_SECTION);
  useEffect(() => {
    const apply = () => {
      const k = sectionForHash(window.location.hash);
      if (k) setActive(k);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const go = (k: SectionKey) => {
    setActive(k);
    if (typeof window !== "undefined") {
      // replaceState, not `location.hash =` — the latter pushes a history entry
      // per rail click, so Back walks the rail instead of leaving the page.
      window.history.replaceState(null, "", `#${hashForSection(k)}`);
    }
    document.getElementById("sea-pane")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const baseline = useMemo(
    () => SEASONAL_BASELINES.find((b) => b.key === baselineKey) ?? SEASONAL_BASELINES[0],
    [baselineKey],
  );
  const SEASONAL_AVG = baseline.curve;

  const toggle = (id: string) =>
    setOverlays((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : prev.length >= MAX_OVERLAYS ? prev : [...prev, id],
    );
  const toggleYear = (y: number) => toggle(String(y));

  /** Selected overlay curves, in the unit the chart is currently showing. */
  const overlaySeries = useMemo(
    () =>
      overlays
        .map((id, i) => {
          const def = CYCLE_DEFS.find((c) => c.id === id);
          const curve = def ? cycleCurve(def.mod).curve : yearCurve(Number(id));
          if (!curve) return null;
          return {
            id,
            /** Chart end-label. Kept short so it fits the label gutter. */
            short: def ? def.short : id,
            /** Hover readout / summary chip name. */
            label: def ? def.label : id,
            ...OVERLAY_SLOTS[i % OVERLAY_SLOTS.length],
            pct: curve,
            values: mode === "pct" ? curve : curve.map((p) => YTD_BASE_PX * (1 + p / 100)),
          };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null),
    [overlays, mode],
  );

  // The seasonal curve, in whichever unit the chart is currently showing.
  const seasonSeries = useMemo(
    () => (mode === "pct" ? SEASONAL_AVG : SEASONAL_AVG.map((p) => YTD_BASE_PX * (1 + p / 100))),
    [mode, SEASONAL_AVG],
  );
  const yearSeries = mode === "pct" ? YTD_2026_PCT : YTD_2026_PX;

  const padRight = overlaySeries.length ? RIGHT_GUTTER_WIDE : PAD.right;
  const innerW = Math.max(0, width - PAD.left - padRight);
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const { yMin, yMax } = useMemo(() => {
    const all = [...seasonSeries, ...yearSeries, ...overlaySeries.flatMap((o) => o.values)];
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    if (mode === "pct") {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    return { yMin: lo, yMax: hi };
  }, [seasonSeries, yearSeries, overlaySeries, mode]);

  const x = (i: number) => PAD.left + (innerW * i) / (N - 1);
  const y = (v: number) => PAD.top + innerH - (innerH * (v - yMin)) / (yMax - yMin);

  const path = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");

  const seasonPath = useMemo(
    () => (innerW > 0 ? path(seasonSeries) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonSeries, innerW, yMin, yMax],
  );
  const yearPath = useMemo(
    () => (innerW > 0 ? path(yearSeries) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yearSeries, innerW, yMin, yMax],
  );

  const ticks = useMemo(() => niceTicks(yMin, yMax, 6), [yMin, yMax]);

  // Headline numbers, all measured at the last session we have.
  const last = LIVE - 1;
  const ytdPct = YTD_2026_PCT[last];
  const seasonToDate = SEASONAL_AVG[last];
  const spread = ytdPct - seasonToDate;
  const seasonFull = SEASONAL_AVG[N - 1];
  const seasonRemaining = seasonFull - seasonToDate;

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (innerW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = Math.round((px / innerW) * (N - 1));
    setHover(i < 0 ? 0 : i > N - 1 ? N - 1 : i);
  };

  const hYear = hover != null && hover < LIVE ? yearSeries[hover] : null;

  return (
    <>
      <style>{SHELL_CSS}</style>
      <div className="sea-shell">
        <nav className="sea-rail" aria-label="Seasonality sections">
          {SECTION_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="sea-railgrp">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className="sea-railitem"
                  aria-current={active === it.key ? "true" : undefined}
                  onClick={() => go(it.key)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* GRID with a minmax(0,1fr) track, not a flex column. As flex items
            these cards carry min-width:auto, so a wide table inside one pushes
            the CARD past the viewport and its own overflow:auto wrapper never
            gets to scroll — the whole page scrolls sideways instead. A 0-min
            track lets the card shrink and hand the overflow back to the wrapper
            built to handle it. Matters most on a phone, which is where this
            page gets opened from a social link. */}
        <div id="sea-pane" className="sea-pane">
      {active === "season" ? (
        <>
      <SeaCard
        title="S&P 500 Seasonality vs 2026"
        subtitle={`SPX cash index · ${baseline.label} average (${baseline.span}, ${baseline.years} years) · 2026 through ${dayLabel(last)}`}
        padding={20}
      >
        {/* Baseline window */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: INK,
              marginRight: 2,
            }}
          >
            Baseline
          </span>
          {SEASONAL_BASELINES.map((b) => {
            const on = b.key === baselineKey;
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={on}
                onClick={() => setBaselineKey(b.key)}
                title={`${b.span} · ${b.years} years`}
                style={{
                  padding: "6px 13px",
                  borderRadius: 8,
                  border: `1px solid ${on ? SEASON_COLOR : HOME_THEME.border}`,
                  background: on
                    ? `linear-gradient(180deg, ${SEASON_COLOR}33, ${SEASON_COLOR}0D)`
                    : "rgba(255,255,255,0.04)",
                  color: on ? SEASON_COLOR : HOME_THEME.text,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        {/* Unit toggle + legend */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {([
              { k: "pct" as Mode, label: "% Return" },
              { k: "price" as Mode, label: "Index Level" },
            ]).map((m) => {
              const on = mode === m.k;
              return (
                <button
                  key={m.k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMode(m.k)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    border: `1px solid ${on ? HOME_THEME.cyan : HOME_THEME.border}`,
                    background: on
                      ? `linear-gradient(180deg, ${HOME_THEME.cyan}33, ${HOME_THEME.cyan}0D)`
                      : "rgba(255,255,255,0.04)",
                    color: on ? HOME_THEME.cyan : HOME_THEME.text,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 18, fontSize: 12, fontWeight: 700 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 22, height: 2, background: SEASON_COLOR, display: "inline-block" }} />
              Seasonal avg ({baseline.span})
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 22, height: 2, background: YEAR_COLOR, display: "inline-block" }} />
              2026 {mode === "pct" ? "(index level on right axis)" : "(% on right axis)"}
            </span>
          </div>
        </div>

        {/* Compare years — collapsed by default; 98 year chips is a lot of
            chrome for a control most visitors never touch. */}
        {/* The single best thing on this page, so it is styled like a call to
            action rather than a disclosure: accent border, filled ground, an
            explicit "click to open" and a caret that rotates when it does.
            A bare ▸ next to grey text got missed by everyone who saw it. */}
        <details className="sea-compare" style={{ marginBottom: 14, borderRadius: 12 }}>
          <summary
            style={{
              listStyle: "none",
              cursor: "pointer",
              padding: "13px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              color: INK,
              fontSize: 13.5,
              fontWeight: 800,
              letterSpacing: "0.01em",
            }}
          >
            <span aria-hidden className="sea-caret">▶</span>
            <span style={{ fontSize: 15, fontWeight: 800 }}>Compare any year</span>
            {overlaySeries.length ? (
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {overlaySeries.map((o) => (
                  <span
                    key={o.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: `1px solid ${o.color}`,
                      color: o.color,
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.02em",
                    }}
                  >
                    <svg width={16} height={6} aria-hidden>
                      <line x1={0} y1={3} x2={16} y2={3} stroke={o.color} strokeWidth={2} strokeDasharray={o.dash || undefined} />
                    </svg>
                    {o.short}
                  </span>
                ))}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
                Put 1987, 2008, 2020, or the average midterm or election year, straight on top of {LIVE_YEAR}
              </span>
            )}
            <span className="sea-comparecta" aria-hidden>Click to open</span>
          </summary>

          <div style={{ padding: "0 14px 14px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: INK }}>
                {overlays.length}/{MAX_OVERLAYS} selected
                {overlays.length >= MAX_OVERLAYS ? " · deselect one to add another" : ""}
              </span>
              {overlays.length ? (
                <button type="button" onClick={() => setOverlays([])} style={clearBtn}>
                  Clear
                </button>
              ) : null}
              {QUICK_PICKS.filter((y) => YEAR_META[String(y)]).map((y) => (
                <button key={y} type="button" onClick={() => toggleYear(y)} style={quickBtn(overlays.includes(String(y)))}>
                  {y}
                </button>
              ))}
            </div>

            {/* ── Election cycle averages ──────────────────────────────────
                Not single years: each of these is the average path across
                every year in that slot of the four-year cycle. They occupy
                the same four overlay slots as year chips, so selecting one
                costs a slot. */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <span style={{ width: 46, flexShrink: 0, fontSize: 11, fontWeight: 800, color: HOME_THEME.green }}>
                Cycle
              </span>
              {CYCLE_DEFS.map((c) => {
                const on = overlays.includes(c.id);
                const slot = on ? OVERLAY_SLOTS[overlays.indexOf(c.id) % OVERLAY_SLOTS.length] : null;
                const n = ALMANAC.presidential.n[c.row];
                const avg = ALMANAC.presidential.avg[c.row] * 100;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    title={`Average of all ${n} ${c.label.toLowerCase()} since ${ALMANAC.meta.start.slice(0, 4)} · full-year average ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`}
                    onClick={() => toggle(c.id)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 6,
                      border: `1px solid ${slot ? slot.color : HOME_THEME.border}`,
                      background: slot ? `${slot.color}2E` : "rgba(255,255,255,0.04)",
                      color: slot ? slot.color : INK,
                      fontSize: 11,
                      fontWeight: on ? 800 : 700,
                      cursor: "pointer",
                    }}
                  >
                    {c.label} <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>n={n}</span>
                  </button>
                );
              })}
            </div>

            {DECADES.map(([dec, years]) => (
              <div key={dec} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                <span style={{ width: 46, flexShrink: 0, fontSize: 11, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>
                  {dec}s
                </span>
                {years.map((y) => {
                  const on = overlays.includes(String(y));
                  const slot = on ? OVERLAY_SLOTS[overlays.indexOf(String(y)) % OVERLAY_SLOTS.length] : null;
                  const meta = YEAR_META[String(y)];
                  return (
                    <button
                      key={y}
                      type="button"
                      aria-pressed={on}
                      title={`${y} finished ${meta.ret >= 0 ? "+" : ""}${meta.ret.toFixed(2)}%`}
                      onClick={() => toggleYear(y)}
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: `1px solid ${slot ? slot.color : HOME_THEME.border}`,
                        background: slot ? `${slot.color}2E` : "rgba(255,255,255,0.04)",
                        color: slot ? slot.color : INK,
                        fontSize: 11,
                        fontWeight: on ? 800 : 600,
                        fontVariantNumeric: "tabular-nums",
                        cursor: "pointer",
                      }}
                    >
                      {String(y).slice(2)}
                    </button>
                  );
                })}
              </div>
            ))}
            <p style={{ margin: "10px 0 0", fontSize: 12, color: INK, lineHeight: 1.6, maxWidth: "72ch" }}>
              Every year is re-based to its own prior 31-Dec close, so the lines are comparable regardless of the index
              level at the time, so 1932 and 2026 sit on the same axis. Hover a chip for that year&apos;s full-year
              return. Four is the cap: past six lines the hues stop being reliably separable, so each overlay carries a
              dash pattern and an end label as well as a color.
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: INK, lineHeight: 1.6, maxWidth: "72ch" }}>
              The four <b>Cycle</b> chips are averages, not years: every year in that slot of the four-year political
              cycle, averaged day by day. {LIVE_YEAR} is itself a midterm year, and it is left out of its own average,
              because a part-finished year would drag the tail of the line you are comparing against.
            </p>
          </div>
        </details>

        {/* Chart */}
        <div ref={wrapRef} style={{ width: "100%" }}>
          {innerW > 0 ? (
            <>
            <svg
              width={width}
              height={CHART_H}
              role="img"
              aria-label="S&P 500 seasonality versus 2026 year to date"
              style={{ display: "block", touchAction: "none", overflow: "visible" }}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {/* horizontal grid + y labels */}
              {ticks.map((t) => (
                <g key={`y${t}`}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + innerW}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={t === 0 && mode === "pct" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)"}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 8}
                    y={y(t) + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill={INK}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {mode === "pct" ? `${t.toFixed(1)}%` : Math.round(t).toLocaleString("en-US")}
                  </text>
                  {/* Same tick, the other unit. This is what makes the 2026
                      LEVEL readable straight off a seasonal % chart. */}
                  <text
                    x={PAD.left + innerW + 8}
                    y={y(t) + 4}
                    textAnchor="start"
                    fontSize={11}
                    fill={YEAR_COLOR}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {mode === "pct"
                      ? Math.round(pctToPx(t)).toLocaleString("en-US")
                      : `${pxToPct(t).toFixed(1)}%`}
                  </text>
                </g>
              ))}

              {/* Month gridlines + labels. Every OTHER label once the plot gets
                  narrow: twelve three-letter labels across a 340px phone chart
                  is ~28px each and they overlap into an unreadable smear. The
                  gridlines all stay — it is only the text that has to thin. */}
              {MONTHS.map((m, mi) => (
                <g key={m.label}>
                  <line
                    x1={x(m.day)}
                    x2={x(m.day)}
                    y1={PAD.top}
                    y2={PAD.top + innerH}
                    stroke="rgba(255,255,255,0.07)"
                    strokeDasharray="3 4"
                  />
                  {mi % (innerW < 470 ? 2 : 1) === 0 ? (
                    <text x={x(m.day) + 4} y={CHART_H - 10} fontSize={11} fontWeight={700} fill={INK}>
                      {m.label}
                    </text>
                  ) : null}
                </g>
              ))}

              {/* the part of the year 2026 has not reached yet */}
              <rect
                x={x(LIVE - 1)}
                y={PAD.top}
                width={Math.max(0, PAD.left + innerW - x(LIVE - 1))}
                height={innerH}
                fill="rgba(255,255,255,0.025)"
              />

              {/* Overlay years sit UNDER the two primary lines: they are the
                  comparison, not the subject. */}
              {overlaySeries.map((o) => {
                const d = o.values
                  .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
                  .join(" ");
                const endI = o.values.length - 1;
                return (
                  <g key={o.id}>
                    <path d={d} fill="none" stroke={o.color} strokeWidth={1.8} strokeDasharray={o.dash || undefined} opacity={0.95} />
                    <circle cx={x(endI)} cy={y(o.values[endI])} r={3} fill={o.color} />
                    {/* Direct label: identity never depends on the hue alone.
                        It sits in its OWN gutter column, past the second-unit
                        price ticks, so the two label sets cannot collide. */}
                    <line
                      x1={x(endI)}
                      x2={PAD.left + innerW + YEAR_LABEL_DX - 4}
                      y1={y(o.values[endI])}
                      y2={y(o.values[endI])}
                      stroke={o.color}
                      strokeWidth={1}
                      opacity={0.35}
                    />
                    <text x={PAD.left + innerW + YEAR_LABEL_DX} y={y(o.values[endI]) + 4} fontSize={11} fontWeight={800} fill={o.color}>
                      {o.short}
                    </text>
                  </g>
                );
              })}

              <path d={seasonPath} fill="none" stroke={SEASON_COLOR} strokeWidth={2} opacity={0.85} />
              <path
                d={yearPath}
                fill="none"
                stroke={YEAR_COLOR}
                strokeWidth={2.4}
                strokeLinejoin="round"
              />

              {/* end-of-2026 marker */}
              <circle cx={x(last)} cy={y(yearSeries[last])} r={4} fill={YEAR_COLOR} />

              {/* crosshair */}
              {hover != null ? (
                <g>
                  <line
                    x1={x(hover)}
                    x2={x(hover)}
                    y1={PAD.top}
                    y2={PAD.top + innerH}
                    stroke="rgba(255,255,255,0.35)"
                  />
                  <circle cx={x(hover)} cy={y(seasonSeries[hover])} r={3.5} fill={SEASON_COLOR} />
                  {overlaySeries.map((o) =>
                    hover < o.values.length ? (
                      <circle key={o.id} cx={x(hover)} cy={y(o.values[hover])} r={3} fill={o.color} />
                    ) : null,
                  )}
                  {hYear != null ? (
                    <circle cx={x(hover)} cy={y(hYear)} r={3.5} fill={YEAR_COLOR} />
                  ) : null}
                </g>
              ) : null}
            </svg>
            </>
          ) : (
            <div style={{ height: CHART_H }} />
          )}
        </div>

        {/* Readout — fixed height so the chart does not jump on hover */}
        <div
          style={{
            marginTop: 10,
            minHeight: 22,
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {hover != null ? (
            <>
              <span style={{ fontWeight: 800 }}>{dayLabel(hover)}</span>
              <span style={{ color: SEASON_COLOR }}>
                Seasonal {fmtPct(SEASONAL_AVG[hover])} · {fmtPx(pctToPx(SEASONAL_AVG[hover]))}
              </span>
              <span style={{ color: YEAR_COLOR }}>
                2026{" "}
                {hover < LIVE
                  ? `${fmtPct(YTD_2026_PCT[hover])} · SPX ${fmtPx(YTD_2026_PX[hover])}`
                  : "—"}
              </span>
              {overlaySeries.map((o) =>
                hover < o.pct.length ? (
                  <span key={o.id} style={{ color: o.color, fontWeight: 700 }}>
                    {o.short} {fmtPct(o.pct[hover])}
                  </span>
                ) : null,
              )}
              {hover < LIVE ? (
                <span>
                  Spread {fmtPct(YTD_2026_PCT[hover] - SEASONAL_AVG[hover])} ·{" "}
                  {`${YTD_2026_PCT[hover] - SEASONAL_AVG[hover] >= 0 ? "+" : ""}${Math.round(
                    ((YTD_2026_PCT[hover] - SEASONAL_AVG[hover]) / 100) * YTD_BASE_PX,
                  )} pts`}
                </span>
              ) : null}
            </>
          ) : (
            <span>Hover the chart for any calendar day.</span>
          )}
        </div>
      </SeaCard>

      <SeaCard title="Where 2026 Stands" padding={20}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile
            label="2026 YTD"
            value={fmtPct(ytdPct)}
            sub={`SPX ${fmtPx(YTD_2026_PX[last])}`}
            color={YEAR_COLOR}
          />
          <StatTile
            label="Seasonal to date"
            value={fmtPct(seasonToDate)}
            sub={`avg of ${baseline.years} years`}
            color={SEASON_COLOR}
          />
          <StatTile
            label={spread >= 0 ? "Ahead of season" : "Behind season"}
            value={fmtPct(spread)}
            sub={`${spread >= 0 ? "+" : ""}${Math.round((spread / 100) * YTD_BASE_PX)} SPX pts`}
            color={spread >= 0 ? HOME_THEME.cyan : HOME_THEME.red}
          />
          <StatTile
            label="Seasonal left in year"
            value={fmtPct(seasonRemaining)}
            sub={`full year avg ${fmtPct(seasonFull)}`}
          />
          <StatTile
            label="Base"
            value={fmtPx(YTD_BASE_PX)}
            sub="2025 year-end SPX close"
          />
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {Object.entries(SEASONAL_YEAR_RETURNS).map(([yr, ret]) => (
            <div
              key={yr}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${HOME_THEME.border}`,
                background: "rgba(255,255,255,0.03)",
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ marginRight: 8 }}>{yr}</span>
              <span style={{ color: ret >= 0 ? HOME_THEME.cyan : HOME_THEME.red }}>{fmtPct(ret)}</span>
            </div>
          ))}
        </div>

      </SeaCard>

        </>
      ) : (
        <SeasonalityAlmanac active={active} />
      )}
        </div>
      </div>
    </>
  );
}

/**
 * Chips are grouped by decade so 98 years stay scannable.
 *
 * The LIVE year is excluded: its curve stops at today, so overlaying it just
 * redraws the orange line in a second color and ends mid-chart.
 */
const DECADES: [number, number[]][] = (() => {
  const byDecade = new Map<number, number[]>();
  for (const y of [...OVERLAY_YEARS].filter((y) => y !== LIVE_YEAR).sort((a, b) => a - b)) {
    const d = Math.floor(y / 10) * 10;
    if (!byDecade.has(d)) byDecade.set(d, []);
    byDecade.get(d)!.push(y);
  }
  return [...byDecade.entries()].sort((a, b) => b[0] - a[0]);
})();

/** The years people actually reach for. Filtered against the data at render. */
const QUICK_PICKS = [2022, 2020, 2018, 2008, 1987];

const clearBtn: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 6,
  border: `1px solid ${HOME_THEME.border}`,
  background: "rgba(255,255,255,0.06)",
  color: INK,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const quickBtn = (on: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: 6,
  border: `1px solid ${on ? HOME_THEME.cyan : HOME_THEME.border}`,
  background: on ? `${HOME_THEME.cyan}2E` : "rgba(255,255,255,0.04)",
  color: on ? HOME_THEME.cyan : INK,
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
});
