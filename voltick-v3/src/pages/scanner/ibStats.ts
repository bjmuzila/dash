// ─────────────────────────────────────────────────────────────────────────────
// IB STATS — THE MATHS.
//
// Transcribed 1:1 from v2's `components/scanner/IbStatsTab.tsx` (1863 lines),
// with the four helpers the tab imports from `lib/ibStats.ts` (`avg`, `med`,
// `clock`, and the `IbDataset` / `SlimDay` types) copied in beside them, against
// the checklist in docs/parity/scanner.md Part G, rows G1–G250 and G251–G278.
//
// Nothing below was re-derived from the spec table. Every threshold, every
// label, every tie-break and every guard was read out of the v2 file while this
// one was written, because this tab's numbers are all conditional base rates and
// a boundary moved by one point changes a percentage nobody can then reconcile.
//
// TEN pieces of business logic here are NOT obvious from the screen:
//
//   1. THE RANGE IS A PARAMETER, NOT A CONSTANT. Every rule asks "the range
//      built from 09:30 for N minutes"; IB is just N=60. `rangeEnd(win)` is
//      `570 + win` and downstream code keys off REND, never off a literal 630.
//      The two places v2 forgot this are marked (rule 13's scored bucket, and
//      every hardcoded "10:30" string).
//   2. A BREAK IS A BAR **CLOSE** OUTSIDE THE RANGE. A wick-only excursion is a
//      TOUCH, and the two are counted in different columns everywhere. The day
//      types (single/both/neither) are built from TOUCHES; the "Break" column,
//      the live `status` and every `fcb` statistic are built from CLOSES. A
//      session can be a single-break day by wick and have no close break at all.
//   3. THE RANGE BARS ARE `min >= 570 && min < REND` — EXCLUSIVE at the end, so
//      the 10:30 bar itself is already post-range and can be the break bar.
//   4. FOUR INDEPENDENT COPIES OF THE WIDTH CLASS, with FOUR different
//      sample-size guards, live in v2. They are ported as four named functions
//      below (`widthClassLive` / `widthClassDerived` / `widthClassEod` /
//      `widthClassDataset`) rather than unified: unifying them silently changes
//      the numbers on four different cards. See the block comment above them.
//   5. FIVE INCOMPATIBLE BREAK-TIMING LADDERS, same reason, same treatment
//      (`breakTimeBucketScored` … `BREAK_TIME_WINDOWS`).
//   6. "CONTAINED", `first`'s TIE-BREAK and `retest` ARE EACH DEFINED THREE
//      (two) DIFFERENT WAYS between the offline dataset, the EOD grader and the
//      live tape. All variants are ported separately and named for their path.
//   7. `scoreWithHistory` — the function behind every family pill and every
//      Probability Engine gauge — APPLIES NO MINIMUM-SAMPLE FLOOR. A rule
//      matching 2 sessions reports its rate with the same weight and the same
//      colour as one matching 900. That is v2's behaviour and it is preserved.
//   8. `bestSample` walks the condition stack from tightest to loosest and takes
//      the FIRST group with ≥ 40 members; if nothing qualifies it falls back to
//      the WHOLE dataset under the label "all sessions". The label is the only
//      thing on screen that says which happened.
//   9. `pHigh` FALLS BACK TO A HARD-CODED 50 when no conditioned session ever
//      recorded a first touch — visually indistinguishable from a measured 50%.
//  10. THE DATASET IS A STATIC EXPORT. `hist.avgIb` / `hist.avgAtr` are the last
//      20 sessions OF THAT FILE, not the last 20 real sessions, so the live
//      width bucket is measured against averages frozen at LAST_UPDATED.
//
// ── lib/ibStats.ts: WHAT WAS AND WAS NOT PORTED ──────────────────────────────
// The tab imports exactly four things from that 508-line module: `avg`, `med`,
// `clock` and the types. `parseCsv`, `buildDays`, `enrich`, `baseBreak`,
// `analyzeBreak`, `failOutcome`, `rate` and `ES_TICK` are NEVER CALLED IN THE
// BROWSER — they document the semantics of the OFFLINE exporter
// (`ib-backtest-esu6.html` → "Export JSON for dashboard"), which is what writes
// `public/data/ib-<SYM>.json`. Those ~310 lines define DATASET FIELDS, not
// rendered values, and shipping them in the page chunk is dead weight behind a
// barrel import. They are NOT ported here. Where a dataset definition differs
// from the live one the difference is recorded at the live definition, because
// that difference is the thing that silently changes a percentage.
// If v3 ever regenerates the datasets, the engine belongs in a build-time script
// (`scripts/ib-export.ts`), not in `src/pages/`.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// `confluentDays()` uses a `Set` for the discordant complement. v2 wrote
// `days.filter(d => d.bias && !conf.includes(d))` — an O(n) scan inside an O(n)
// filter, i.e. O(n²) over ~2,300 sessions, re-run on EVERY render of the owner
// block (which has no `useMemo` anywhere). The Set gives byte-identical output;
// only the cost changes. Recorded in docs/parity/scanner.md Part G, "Do not
// port" item 14.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `tdDim` (`IbStatsTab.tsx:118`) — `{...td, fontSize: 14}` where `td` is
//   already 14. A no-op override whose name promises a difference that does not
//   exist. It is styling anyway, which is step 3.
// • The `accent` prop plumbing. `PageCard`'s `Card` documents `accent` as
//   ignored and the tab's local `Card` re-implements it as a title colour only —
//   six hues over sixteen cards with no semantic rule. The per-card accent NAMES
//   are kept below as data (they are what step 3 would have to invent otherwise)
//   but v3 should pick one token for a card title and drop the prop.
// • `failOutcome` and `rate` from lib/ibStats (`:483–493`, `:508`). Exported and
//   called by nothing; `rate` is a duplicate of `rateNum`. Port `failOutcome`
//   when a surface actually renders its four outcomes.
// • `hooks/useIbDirection.ts` in its hook form — a third copy of `etMin`/
//   `etDate`, a second `MIN_N`, a second width ladder and a second `bestSample`,
//   imported by nothing. If the home rail wants `pHigh`, it calls
//   `bestSample()` + `pHighOf()` from this file. See docs/parity Part G, G305–G308.
//
// Spec: docs/parity/scanner.md Part G, rows G9–G14, G26–G43, G44–G76, G77–G116,
// G117–G141, G162–G218, G236–G250, G251–G278.
// ─────────────────────────────────────────────────────────────────────────────

import { T, V2 } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'

// ─────────────────────────────────────────────────────────────────────────────
// WIRE SHAPES — the static export the tab fetches.
// Transcribed from lib/ibStats.ts:399–451. `slim()` in ib-backtest-esu6.html is
// the only writer; these shapes must stay in step with it.
// ─────────────────────────────────────────────────────────────────────────────

/** One close-confirmed break, as the exporter slims it. */
export interface SlimBreak {
  side: 'H' | 'L'
  breakMin: number
  /** Max favourable excursion / range width. A WICK excursion, not a close. */
  rExt: number
  /** Max adverse excursion / range width — the heat the winner sat through. */
  rAdv: number
  volSurge: boolean
  failed: boolean
  /** POINTS, not range widths. See the unit note on failOutcome in v2. */
  peakBeforeFail: number
  fadeMid: boolean
  fadeOpp: boolean
  retest: boolean
  retestCont: boolean | null
  /** Keys are "0.5" | "1" | "1.5" | "2" — `String(1)` is "1", never "1.0". */
  hit: Record<string, boolean>
  fibA: { hit: boolean; cont: boolean; fail: boolean; mfe: number | null; barsToTouch: number | null }
  fibB: { hit: boolean; cont: boolean }
}

export interface SlimDay {
  date: string
  width: number
  dayRange: number
  atr: number | null
  avgIB: number | null
  widthBucket: 'narrow' | 'normal' | 'wide' | null
  first: 'H' | 'L'
  bias: 'H' | 'L' | null
  closeZone: 'top25' | 'bot25' | 'mid50'
  openType: 'OAR-H' | 'OAR-L' | 'HIR' | 'LIR' | null
  orbDir: 'H' | 'L' | null
  fvg: 'bull' | 'bear' | null
  touchedH: boolean
  touchedL: boolean
  singleBreak: boolean
  bothBroke: boolean
  neitherBroke: boolean
  firstTouchSide: 'H' | 'L' | null
  firstTouchMin: number | null
  containedAt2: boolean
  containedBrokeLate: boolean
  /**
   * EXPORT-ONLY. Nothing in the repo computes this — it comes from `slim()` in
   * the backtest HTML. Card 8's "Never trades back to the IB midpoint" row reads
   * it; an export missing the field renders a red 0.0% as if measured.
   */
  noMidReturn: boolean
  /** EXPORT-ONLY, same caveat. Read by card 12's `mid:` details. */
  fvgHitMid: boolean
  /** First close-confirmed break; null on a day that never closed outside. */
  fcb: SlimBreak | null
}

export interface IbDataset {
  symbol: string
  barMinutes: number
  /** Read by NOTHING — the tab shows the hand-typed LAST_UPDATED instead. */
  generated: string
  /** Read by nothing either; the tab uses `days.length`. */
  sessions: number
  from: string
  to: string
  days: SlimDay[]
}

/** A bar off the live candle feed. Only these six fields are ever read. */
export interface IbCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

/** A candle reduced to ET session date + minute-of-day. */
export interface IbBar {
  day: string
  min: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — symbols, windows, clock anchors, sample floors.
// Spec rows G9, G14, G20–G25, G250.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hand-typed, US format, no zero padding (`IbStatsTab.tsx:29`). Nothing compares
 * it to `ds.generated`, so it cannot go stale-detect — it is prose on a card.
 */
export const LAST_UPDATED = '7/11/2026'

export const SYMBOLS = ['ES', 'NQ'] as const
export type IbSymbol = (typeof SYMBOLS)[number]

export interface IbWindowDef {
  min: 60 | 30 | 15 | 5
  label: string
  /** The dashes are EN DASHES (U+2013), not hyphens. */
  range: string
}

/**
 * The four opening-range windows, in strip order. The exporter writes the SAME
 * schema for each, so switching windows is a file swap (G9).
 */
export const WINDOWS: readonly IbWindowDef[] = [
  { min: 60, label: 'IB 60m', range: '09:30–10:30' },
  { min: 30, label: 'ORB 30m', range: '09:30–10:00' },
  { min: 15, label: 'ORB 15m', range: '09:30–09:45' },
  { min: 5, label: 'ORB 5m', range: '09:30–09:35' },
]

export type IbWindow = IbWindowDef['min']

/** The default window on mount — `useState<Win>(60)`. */
export const DEFAULT_WINDOW: IbWindow = 60
/** The default symbol on mount — `useState<Sym>("ES")`. */
export const DEFAULT_SYMBOL: IbSymbol = 'ES'

export const winLabel = (win: IbWindow): string =>
  WINDOWS.find((w) => w.min === win)?.label ?? `${win}m`

export const winRange = (win: IbWindow): string =>
  WINDOWS.find((w) => w.min === win)?.range ?? ''

/** Minute-of-day the opening range closes. 570 = 09:30 ET. */
export const rangeEnd = (win: IbWindow): number => 570 + win

/** 09:30 ET. */
export const RTH_OPEN = 570
/** 16:00 ET — the RTH filter is `min <= 960`, i.e. the 16:00 bar is INCLUDED. */
export const RTH_CLOSE = 960
/** 14:00 ET — the "contained day" cut and the engine's `late` flip. */
export const TWO_PM = 840

/**
 * THE ONE SAMPLE FLOOR THE LIVE CARDS USE (`IbStatsTab.tsx:452`). It gates
 * `bestSample`, the day-of-week matrix swap and the break-side grouping in the
 * active rule. Every other floor on this tab is a different number in a
 * different place — see SAMPLE_FLOORS.
 */
export const MIN_N = 40

/**
 * Every minimum-sample rule in force on this tab, collected so the next reader
 * does not have to find them one at a time (G250). They are NOT interchangeable
 * and they are NOT unified: each one changes a different surface.
 */
export const SAMPLE_FLOORS = {
  /** bestSample, the DOW matrix swap, the break-side group. */
  liveConditional: 40,
  /** `verdict()`'s "thin sample" cut in the Rule Ranking table. */
  verdictThin: 20,
  /** The dead PlaybookLegacy's card filter. */
  playbookLegacy: 15,
  /** The Rule Ranking table's row filter — under this the row VANISHES. */
  ruleRanking: 8,
  /** Trailing windows for the width class. */
  avgIbWindow: 20,
  atrWindow: 14,
  /** lib/ibStats' minimum prior sessions before either trailing mean exists. */
  datasetTrailingMin: 5,
  /** deriveWidthBuckets leaves the first 14 sessions bucketless regardless. */
  deriveWarmup: 14,
  /** lib/ibDaily's guard: fewer trailing sessions than this → no bucket. */
  eodTrailingMin: 14,
  /** Minimum IB bars (and post bars) for the exporter to build a day at all. */
  datasetMinBars: 10,
  /** lib/ibDaily's minimum IB bars. */
  eodMinBars: 3,
  /** The dead IbLevelCanvas' minimum IB bars. */
  levelCanvasMinBars: 2,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS.
// Spec rows G29–G32, G275–G277. `f1` is IbDailyResults' (`:56`); it lives here
// so both files use one copy.
// ─────────────────────────────────────────────────────────────────────────────

/** Two decimals, or an em dash for null / undefined / NaN / ±Infinity. */
export function f2(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? EM_DASH : n.toFixed(2)
}

/** One decimal, same guard. IbDailyResults' width column. */
export function f1(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? EM_DASH : n.toFixed(1)
}

/**
 * `n` of `d` as a 1-dp percentage. The guard is `d` TRUTHY, so `d === 0` gives
 * an em dash and a negative `d` would still compute. Copied as written.
 */
export function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : EM_DASH
}

/** The same ratio unrounded, or null. Every call site renders null as an em dash. */
export function rateNum(n: number, d: number): number | null {
  return d ? (100 * n) / d : null
}

/**
 * THE hit-rate colour ladder (G32 / G243).
 *
 *   null      → T.text     ("not measured" — v2 painted it the body white)
 *   p >= 60   → V2.up      #1FD98A
 *   p <= 40   → V2.red     #EF4444
 *   otherwise → V2.orange  #FB8501
 *
 * Both boundaries are inclusive, so exactly 60 is up and exactly 40 is down;
 * 40 < p < 60 is the warn colour.
 *
 * v2 typed this ladder THREE TIMES with identical numbers — `IbStatsTab.tsx:102`,
 * `IbDailyResults.tsx:134` (the bias-correct figure) and `IbDailyResults.tsx:231`
 * (the hit-rate footer). This is the one copy; both files import it.
 *
 * THE THREE-WAY SPLIT (Brandon, 2026-09-03 — this reverses step 2's collapse
 * onto MOVE_UP/MOVE_DOWN; the tab now runs on v2's palette, not v3 semantics).
 * v2's `HOME_THEME.green` #8ECAE6 is a LIGHT BLUE doing three jobs. As a
 * POSITIVE it is `V2.up` #1FD98A here (v2's own REFRESH_GREEN, the declared
 * up/success role colour); as the tab ACCENT it is `V2.accent` #7dd3fc, see
 * `IB_READ_ACCENT`; as CHROME it keeps #8ECAE6 as `V2.green`.
 * `HOME_THEME.red` #EF4444 → `V2.red`.
 */
export function rateColor(p: number | null | undefined): string {
  if (p == null) return T.text
  if (p >= 60) return V2.up
  if (p <= 40) return V2.red
  return V2.orange
}

/** Mean, or null on an empty array. No NaN filtering — one NaN poisons it. */
export function avg(a: readonly number[]): number | null {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
}

/**
 * "Median" (lib/ibStats.ts:498). On an EVEN-length array this is the UPPER of
 * the two middle values, not their mean. A true median it is not; the card that
 * prints it says "Median IB width" anyway.
 */
export function med(a: readonly number[]): number | null {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)] ?? null
}

/**
 * Minute-of-day as "HH:MM" (lib/ibStats.ts:503). NOTE `Math.round` on the minute
 * part: 634.6 renders "10:35" and 659.6 renders "10:60" — an unreachable clock
 * time. It only ever sees an average, which is where the fraction comes from.
 */
export function clock(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return EM_DASH
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * IbDailyResults' own clock (`:57`). Same shape, NO rounding — it only ever
 * formats an integer `break_min` off the API. Kept separate because collapsing
 * it onto `clock` would start rounding a value that is already whole, which is
 * harmless today and is exactly the kind of "harmless" that stops being so.
 */
export function clockExact(m: number | null | undefined): string {
  return m == null ? EM_DASH : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// ET TIME — never trust the browser's zone.
// Spec rows G49, G50, G55.
// ─────────────────────────────────────────────────────────────────────────────

const ET_MIN_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** `en-CA` specifically, because it formats ISO-like: "YYYY-MM-DD". */
const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Minute-of-day in ET. The `% 24` handles the "24" some ICU builds emit at midnight. */
export function etMin(ts: number): number {
  const p = ET_MIN_FMT.formatToParts(new Date(ts))
  const h = +(p.find((x) => x.type === 'hour')?.value ?? 0)
  const m = +(p.find((x) => x.type === 'minute')?.value ?? 0)
  return (h % 24) * 60 + m
}

/** True ET calendar date of a bar — used to keep sessions apart. */
export function etDate(ts: number): string {
  return ET_DATE_FMT.format(new Date(ts))
}

/**
 * `new Date().getDay()` indexes this (`IbStatsTab.tsx:386`).
 *
 * NOTE this is the BROWSER-LOCAL weekday, not the ET one — the only date
 * computation on the tab that is not ET-anchored. A user west of ET after 21:00
 * local sees the previous weekday, which silently changes rule 0c's condition.
 * Ported as written; step 3 decides whether to anchor it.
 */
export const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Weekday of a session date, parsed at NOON UTC so no timezone can shift it. */
export const dowOf = (d: Pick<SlimDay, 'date'>): number =>
  new Date(`${d.date}T12:00:00Z`).getUTCDay()

/** Monday…Friday, the row order of card 5. Weekends are excluded everywhere. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const

// ─────────────────────────────────────────────────────────────────────────────
// LADDER 1 — RANGE WIDTH CLASS, FOUR TIMES.
//
// Spec rows G236, G237. The four NUMBERS are identical everywhere:
//
//   width < 0.5 × ATR14   OR  width < 0.75 × avgIB20  → narrow
//   width > 1.5 × ATR14   OR  width > 1.25 × avgIB20  → wide
//   otherwise                                          → normal
//
// Strict `<` and `>` on all four; equality lands in `normal`. Narrow is tested
// FIRST, so a width satisfying both branches is narrow.
//
// What differs between the four copies is the SAMPLE GUARD, and that is why they
// are four exports instead of one:
//
//   widthClassLive      guard = both averages merely NON-ZERO. No count check at
//                       all — a single non-zero session passes it. Returns the
//                       UPPERCASE display word, or "—".
//   widthClassDerived   guard = the trailing means exist AND i >= 14.
//   widthClassEod       guard = trailing.length >= 14, then slice(-14)/slice(-20).
//   widthClassDataset   guard = >= 5 prior sessions for EACH mean.
//
// Unifying them changes the numbers on four different cards. Do not.
// ─────────────────────────────────────────────────────────────────────────────

export type WidthBucket = 'narrow' | 'normal' | 'wide'
/** The live card's display word. "—" when either average is 0. */
export type WidthWord = 'NARROW' | 'NORMAL' | 'WIDE' | '—'

/** The shared four-number test, once. Callers supply their own guard. */
function widthClassOf(width: number, atr: number, avgIb: number): WidthBucket {
  if (width < 0.5 * atr || width < 0.75 * avgIb) return 'narrow'
  if (width > 1.5 * atr || width > 1.25 * avgIb) return 'wide'
  return 'normal'
}

/**
 * COPY 1 — the LIVE path (`IbStatsTab.tsx:294–299`).
 *
 * Guard is `hist.avgAtr && hist.avgIb` — truthiness only, no count. Returns the
 * UPPERCASE word the Live Read card prints; `bk = word.toLowerCase()` is what
 * matches `SlimDay.widthBucket` downstream, and `"—".toLowerCase()` is `"—"`,
 * which matches no bucket, so rule 4 goes not-in-play.
 *
 * The two averages come from the STATIC EXPORT's last 20 rows (see buildHist),
 * not from the last 20 real sessions.
 */
export function widthClassLive(width: number, avgAtr: number, avgIb: number): WidthWord {
  if (!avgAtr || !avgIb) return '—'
  const b = widthClassOf(width, avgAtr, avgIb)
  return b === 'narrow' ? 'NARROW' : b === 'wide' ? 'WIDE' : 'NORMAL'
}

/**
 * COPY 2 — the BACKFILL path (`IbStatsTab.tsx:1358–1371`, `deriveWidthBuckets`).
 *
 * Trailing windows only, no lookahead: day i uses the 14/20 sessions BEFORE it.
 * The `i < 14` guard leaves the first 14 sessions bucketless whatever the means
 * computed, and a bucketless day is excluded from every width table
 * (`wd = days.filter(d => d.widthBucket)`).
 *
 * Early-returns the input UNTOUCHED if ANY day already carries a bucket.
 */
export function deriveWidthBuckets(src: readonly SlimDay[]): SlimDay[] {
  if (src.some((d) => d.widthBucket)) return src as SlimDay[]
  const mean = (a: number[]): number | null => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  return src.map((d, i) => {
    const atr = d.atr ?? mean(src.slice(Math.max(0, i - SAMPLE_FLOORS.atrWindow), i).map((x) => x.dayRange))
    const avgIB = d.avgIB ?? mean(src.slice(Math.max(0, i - SAMPLE_FLOORS.avgIbWindow), i).map((x) => x.width))
    if (atr == null || avgIB == null || i < SAMPLE_FLOORS.deriveWarmup) return { ...d, atr, avgIB }
    return { ...d, atr, avgIB, widthBucket: widthClassOf(d.width, atr, avgIB) }
  })
}

/**
 * COPY 3 — the EOD grader (`lib/ibDaily.ts:55–66`, `classifyWidth`).
 *
 * Runs server-side at 16:30 ET and is what stamps `width_bucket` on the rows
 * `/api/ib-results` returns. Ported so v3 can reproduce a row it is shown, and
 * so the guard difference is visible: this one needs 14 trailing SESSIONS before
 * it will classify anything, where the live copy needs none.
 */
export function widthClassEod(
  width: number,
  trailing: readonly { date: string; dayRange: number; ibWidth: number }[],
): WidthBucket | null {
  if (trailing.length < SAMPLE_FLOORS.eodTrailingMin) return null
  const mean = (a: number[]): number | null => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const atr = mean(trailing.slice(-SAMPLE_FLOORS.atrWindow).map((t) => t.dayRange))
  const avgIb = mean(trailing.slice(-SAMPLE_FLOORS.avgIbWindow).map((t) => t.ibWidth))
  if (atr == null || avgIb == null) return null
  return widthClassOf(width, atr, avgIb)
}

/**
 * COPY 4 — the OFFLINE DATASET (`lib/ibStats.ts:168–187`).
 *
 * This is the guard the shipped `widthBucket` values were actually written
 * under: each trailing mean needs at least FIVE prior sessions to exist at all,
 * and either mean being null leaves the bucket null. Trailing 20 for avgIB,
 * trailing 14 for "ATR".
 *
 * NOTE what the exporter calls ATR14 is a plain MEAN of RTH high−low ranges —
 * no gap component, no Wilder smoothing. Card 9's "ATR14" label overstates it.
 */
export function widthClassDataset(
  width: number,
  prior: readonly { width: number; dayRange: number }[],
): WidthBucket | null {
  const prev20 = prior.slice(-SAMPLE_FLOORS.avgIbWindow)
  const prev14 = prior.slice(-SAMPLE_FLOORS.atrWindow)
  const avgIb =
    prev20.length >= SAMPLE_FLOORS.datasetTrailingMin ? avg(prev20.map((d) => d.width)) : null
  const atr =
    prev14.length >= SAMPLE_FLOORS.datasetTrailingMin ? avg(prev14.map((d) => d.dayRange)) : null
  if (avgIb == null || atr == null) return null
  return widthClassOf(width, atr, avgIb)
}

// ─────────────────────────────────────────────────────────────────────────────
// LADDERS 3–5 — close zone, midpoint bias, open type.
// Spec rows G239, G240, G241. These three agree across all paths; only the
// degenerate-width handling and one extra guard differ, both noted.
// ─────────────────────────────────────────────────────────────────────────────

export type CloseZone = 'top25' | 'bot25' | 'mid50'

/** `loc = (ibClose − ibl) / width`, with `width === 0` → 0.5 on the live path. */
export function closeLoc(ibClose: number, ibl: number, width: number): number {
  return width > 0 ? (ibClose - ibl) / width : 0.5
}

/** Both boundaries inclusive TOWARD the extremes. */
export function closeZoneOf(loc: number): CloseZone {
  return loc >= 0.75 ? 'top25' : loc <= 0.25 ? 'bot25' : 'mid50'
}

/** The prose form used in the Live Read memo (`:269`). */
export function closeZoneProse(loc: number): string {
  return loc >= 0.75 ? 'top 25%' : loc <= 0.25 ? 'bottom 25%' : 'middle 50%'
}

/** The uppercase form `buildRules` prints (`:695`). */
export const ZONE_WORD: Record<CloseZone, string> = {
  top25: 'TOP 25%',
  bot25: 'BOTTOM 25%',
  mid50: 'MIDDLE 50%',
}

/** Exactly on the midpoint → null, which disables rules 1, 2, 10 and 12. */
export function biasOf(ibClose: number, mid: number): 'H' | 'L' | null {
  return ibClose > mid ? 'H' : ibClose < mid ? 'L' : null
}

export type OpenType = 'OAR-H' | 'OAR-L' | 'HIR' | 'LIR'

/**
 * Open vs the PRIOR session's RTH range (`IbStatsTab.tsx:327–332`).
 *
 * `lib/ibDaily.ts:182–187` adds a `!(dayOpen > 0)` guard the live path lacks;
 * that is the only difference between the three copies. Card 17's row order is
 * this declaration order: OAR-H, OAR-L, HIR, LIR.
 */
export function openTypeOf(dayOpen: number, pdh: number | null, pdl: number | null): OpenType | null {
  if (pdh == null || pdl == null) return null
  if (dayOpen > pdh) return 'OAR-H'
  if (dayOpen < pdl) return 'OAR-L'
  return dayOpen > (pdh + pdl) / 2 ? 'HIR' : 'LIR'
}

export const OPEN_TYPES: readonly OpenType[] = ['OAR-H', 'OAR-L', 'HIR', 'LIR']

// ─────────────────────────────────────────────────────────────────────────────
// LADDER 2 — EXTENSION MULTIPLES.
// Spec row G238. Always these four, always × range width, always measured from
// the BROKEN LEVEL (range high on a high break, range low on a low break).
// The dataset test is `mfe >= t * width` — inclusive.
// ─────────────────────────────────────────────────────────────────────────────

export const EXT_MULTIPLES = [0.5, 1, 1.5, 2] as const

/** `hit` map keys. `String(1)` is "1", never "1.0" — every lookup depends on it. */
export const EXT_KEYS = ['0.5', '1', '1.5', '2'] as const

// ─────────────────────────────────────────────────────────────────────────────
// LADDER 6 — BREAK TIMING, FIVE INCOMPATIBLE VERSIONS.
//
// Spec row G242. One concept, five implementations, four of which hardcode
// 660/720/780/840/900 while only (b) follows the selected window. They are five
// exports for the same reason the width class is four: collapsing them moves
// numbers on cards that currently disagree, and step 3 has to be able to see
// that they disagree before it decides which one survives.
// ─────────────────────────────────────────────────────────────────────────────

export type BreakTimeBucket = 'early' | 'midday' | 'late'

/**
 * (a) THE SCORED BUCKET — rule 13's `cond` (`IbStatsTab.tsx:898`).
 * `<= 660` / `661–780` / `> 780`, hardcoded, window-independent.
 */
export function breakTimeBucketScored(min: number): BreakTimeBucket {
  return min <= 660 ? 'early' : min <= 780 ? 'midday' : 'late'
}

/**
 * (b) THE IN-PLAY PROSE — rule 13's `read` (`IbStatsTab.tsx:896`). The ONLY
 * variant anchored to the selected window.
 *
 * BUG (v2): the displayed word and the scored bucket use DIFFERENT boundaries.
 * On IB 60m (REND 630) a break at 10:50 reads "early (first 30m…)" — 650 <= 660
 * — and also scores in the <=660 bucket; they agree by luck. On ORB 5m
 * (REND 575) a break at 10:10 (610) is NOT <= 605, so it reads "midday" while
 * still scoring in the EARLY bucket. Ported as written; do not reconcile them
 * here. See docs/parity/scanner.md Part G, row G216.
 */
export function breakTimeWordInPlay(bm: number, rEnd: number, label: string): string {
  return bm <= rEnd + 30 ? `early (first 30m out of the ${label})` : bm <= 780 ? 'midday' : 'late'
}

/**
 * (c) THE PENDING PROSE — rule 13's pending branch (`IbStatsTab.tsx:902`),
 * keyed on the CURRENT clock rather than a break, uppercase, 660/780 again.
 */
export function breakTimeWordPending(nowMin: number): 'EARLY' | 'MIDDAY' | 'LATE' {
  return nowMin <= 660 ? 'EARLY' : nowMin <= 780 ? 'MIDDAY' : 'LATE'
}

/**
 * (d) THE EOD NOTE — `lib/ibDaily.ts:312`. Same boundaries as (a) and (c), a
 * third wording, and it is the string stored in the recorded row's `note`, which
 * is what the daily-results tooltip shows.
 */
export function breakTimeNoteEod(breakMin: number): string {
  return breakMin <= 660 ? 'early break' : breakMin <= 780 ? 'midday break' : 'late break'
}

/**
 * (e) CARD 19's WINDOWS (`IbStatsTab.tsx:1509–1512`). Half-open `[a, b)`.
 * The last window ends at 961 — one minute PAST the 16:00 close, deliberately,
 * so a 16:00 break is included.
 */
export function breakTimeWindows(rEnd: number): readonly [number, number, string][] {
  return [
    [rEnd, 720, `${clock(rEnd)} – 12:00`],
    [720, 780, '12:00 – 13:00'],
    [780, 840, '13:00 – 14:00'],
    [840, 900, '14:00 – 15:00'],
    [900, 961, '15:00 – close'],
  ]
}

/** Card 19's sixth row: every break with `breakMin < 720`. */
export const BEFORE_NOON_MIN = 720

// ─────────────────────────────────────────────────────────────────────────────
// LADDER 11 — DAY TYPE, and the three definitions of "contained".
// Spec rows G247, G266, G72.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Day type, from WICK TOUCHES — mutually exclusive and exhaustive
 * (`lib/ibStats.ts:215–217`, `lib/ibDaily.ts:105–107`).
 *
 * These are TOUCHES while `brokeH`/`brokeL` (the "Break" column, the live
 * status) are CLOSES, so a session can be `singleBreak` here and have no close
 * break at all.
 */
export function dayTypeOf(touchedH: boolean, touchedL: boolean): {
  singleBreak: boolean
  bothBroke: boolean
  neitherBroke: boolean
} {
  return {
    singleBreak: touchedH !== touchedL,
    bothBroke: touchedH && touchedL,
    neitherBroke: !touchedH && !touchedL,
  }
}

/**
 * "CONTAINED AT 14:00" — LIVE PATH (`IbStatsTab.tsx:371–374`).
 * CLOSE-based, and only answerable once the clock passes 14:00; before that it
 * is null and rule 14 renders its PENDING branch.
 *
 * The other two definitions are `containedAtTwoEod` and `containedAtTwoDataset`
 * below. They do not agree, and rule 14 therefore asks a question the historical
 * rate it quotes was not measured on (Q4).
 */
export function containedAtTwoLive(
  bars: readonly IbBar[],
  nowMin: number,
  rEnd: number,
  ibh: number,
  ibl: number,
): boolean | null {
  if (nowMin < TWO_PM) return null
  const upTo2 = bars.filter((b) => b.min <= TWO_PM)
  return !upTo2.some((b) => b.min >= rEnd && (b.c > ibh || b.c < ibl))
}

/**
 * "CONTAINED AT 14:00" — EOD GRADER (`lib/ibDaily.ts:202–204`).
 * CLOSE-based like the live path, but computed over the POST-range bars with
 * `min < 840` (strict, where the live path uses `<= 840`), and it also decides
 * `containedBrokeLate` from the bars at or after 14:00.
 */
export function containedAtTwoEod(
  post: readonly IbBar[],
  ibh: number,
  ibl: number,
): { containedAt2: boolean; containedBrokeLate: boolean } {
  const containedAt2 = !post.some((b) => b.min < TWO_PM && (b.c > ibh || b.c < ibl))
  const containedBrokeLate =
    containedAt2 && post.some((b) => b.min >= TWO_PM && (b.c > ibh || b.c < ibl))
  return { containedAt2, containedBrokeLate }
}

/**
 * "CONTAINED AT 14:00" — OFFLINE DATASET (`lib/ibStats.ts:232–243`).
 * WICK-based, and therefore STRICTLY STRICTER than the other two: a wick outside
 * the range disqualifies the day here and does not there. Every historical
 * "contained" percentage on this tab was measured under THIS definition.
 * Also note `upTo2` must be non-empty for the day to count as contained at all.
 */
export function containedAtTwoDataset(
  post: readonly IbBar[],
  ibh: number,
  ibl: number,
): { containedAt2: boolean; containedBrokeLate: boolean } {
  const upTo2 = post.filter((b) => b.min < TWO_PM)
  const containedAt2 =
    upTo2.length > 0 &&
    Math.max(...upTo2.map((b) => b.h)) <= ibh &&
    Math.min(...upTo2.map((b) => b.l)) >= ibl
  const containedBrokeLate =
    containedAt2 && post.some((b) => b.min >= TWO_PM && (b.h > ibh || b.l < ibl))
  return { containedAt2, containedBrokeLate }
}

// ─────────────────────────────────────────────────────────────────────────────
// `first` — WHICH EXTREME FORMED FIRST, two definitions.
// Spec rows G57, G255.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LIVE + EOD (`IbStatsTab.tsx:261–266`, `lib/ibDaily.ts:90–95`).
 * First index at which the bar high equals the range high vs the first at which
 * the bar low equals the range low.
 *
 * NO TIE-BREAK: a single bar that is both the range high AND the range low
 * resolves to "L". `firstFormedDataset` has a third branch for exactly this
 * case, so the live reading and the dataset disagree on one-bar ranges.
 */
export function firstFormedLive(ibBars: readonly IbBar[], ibh: number, ibl: number): 'H' | 'L' {
  let hiIdx = Infinity
  let loIdx = Infinity
  ibBars.forEach((b, i) => {
    if (b.h === ibh) hiIdx = Math.min(hiIdx, i)
    if (b.l === ibl) loIdx = Math.min(loIdx, i)
  })
  return hiIdx < loIdx ? 'H' : 'L'
}

/**
 * OFFLINE DATASET (`lib/ibStats.ts:128–134`) — the values actually stored in
 * `SlimDay.first`, and therefore the population every "formation order" rate on
 * this tab was measured over.
 *
 * The third branch is the difference: on a tie the FIRST BAR's direction decides
 * (an up bar means the low printed first).
 */
export function firstFormedDataset(ibBars: readonly IbBar[], ibh: number, ibl: number): 'H' | 'L' {
  let hiIdx = Infinity
  let loIdx = Infinity
  ibBars.forEach((b, i) => {
    if (b.h === ibh) hiIdx = Math.min(hiIdx, i)
    if (b.l === ibl) loIdx = Math.min(loIdx, i)
  })
  if (hiIdx < loIdx) return 'H'
  if (loIdx < hiIdx) return 'L'
  const b0 = ibBars[0]
  return b0 && b0.c >= b0.o ? 'L' : 'H'
}

// ─────────────────────────────────────────────────────────────────────────────
// `retest` — THREE definitions, materially different statistics under one name.
// Spec rows G71, G270, and lib/ibDaily.ts:147–156.
// ─────────────────────────────────────────────────────────────────────────────

/** ES and NQ both. v2's live path writes `sym === "ES" ? 0.25 : 0.25` — a no-op. */
export const TICK = 0.25
/** The retest tolerance is TWO ticks either side of the broken level. */
export const RETEST_TICKS = 2

export interface RetestRead {
  retest: boolean
  retestCont: boolean | null
}

/**
 * LIVE (`IbStatsTab.tsx:359–368`). Price comes back to within 2 ticks of the
 * broken level; continuation is any LATER bar that CLOSES beyond the level.
 *
 * The live retest does NOT require the close to have held outside on the retest
 * bar, and does not exclude a break that already failed. Both of those are
 * requirements in `retestDataset`, which is what the quoted historical rate was
 * measured on.
 */
export function retestLive(
  after: readonly IbBar[],
  side: 'H' | 'L',
  lvl: number,
): RetestRead {
  const rtIdx = after.findIndex((b) =>
    side === 'H' ? b.l <= lvl + RETEST_TICKS * TICK : b.h >= lvl - RETEST_TICKS * TICK,
  )
  if (rtIdx < 0) return { retest: false, retestCont: null }
  return {
    retest: true,
    retestCont: after.slice(rtIdx + 1).some((b) => (side === 'H' ? b.c > lvl : b.c < lvl)),
  }
}

/**
 * EOD GRADER (`lib/ibDaily.ts:147–156`). Identical to the live definition —
 * same tolerance, same "a close beyond the level" continuation. Named separately
 * because it is a SECOND implementation that has to be kept in step, and because
 * it is the one that stamps the `retest` / `retest_cont` columns the daily
 * scoreboard renders.
 */
export const retestEod = retestLive

/**
 * OFFLINE DATASET (`lib/ibStats.ts:287–310`) — a genuinely different statistic:
 *
 *   • the retest bar must be AFTER the break bar (`j > 0`);
 *   • a break that ALREADY FAILED can never register a retest (`failIdx == null`);
 *   • the close must still be OUTSIDE on the retest bar;
 *   • continuation means a NEW EXTREME beyond the running extreme up to and
 *     including the retest bar — not merely a close beyond the level.
 *
 * Card 13 ("Retest Continuation") and rule 8's historical rate both read the
 * dataset, so they answer this question while the live read asks the looser one.
 */
export function retestDataset(
  after: readonly IbBar[],
  side: 'H' | 'L',
  lvl: number,
  failIdx: number | null,
  extremeThrough: (upToIdx: number) => number,
): RetestRead {
  if (failIdx != null) return { retest: false, retestCont: null }
  const rtIdx = after.findIndex((b, j) => {
    if (j <= 0) return false
    const near = side === 'H' ? b.l <= lvl + RETEST_TICKS * TICK : b.h >= lvl - RETEST_TICKS * TICK
    const held = side === 'H' ? b.c > lvl : b.c < lvl
    return near && held
  })
  if (rtIdx < 0) return { retest: false, retestCont: null }
  const preExt = extremeThrough(rtIdx)
  return {
    retest: true,
    retestCont: after
      .slice(rtIdx + 1)
      .some((b) => (side === 'H' ? b.h > preExt : b.l < preExt)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE SESSION — `LiveToday`'s memo, as one pure function.
// Spec rows G44–G76.
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveTarget {
  t: number
  px: number
  hit: boolean
}

export interface LivePending {
  pending: true
  nowMin: number
  price: number
}

export interface LiveSession {
  pending: false
  today: string
  nowMin: number
  price: number
  ibh: number
  ibl: number
  mid: number
  width: number
  ibComplete: boolean
  first: 'H' | 'L'
  bias: 'H' | 'L' | null
  /** Prose ("top 25%"). `zone` is the machine key for the same fact. */
  closeZone: string
  zone: CloseZone
  orbDir: 'H' | 'L' | null
  /** Rendered ONLY by the dead RuleBoard — no live card shows it. */
  status: string
  bucket: WidthWord
  breakSide: 'H' | 'L' | null
  breakMin: number | null
  targets: LiveTarget[]
  dayHigh: number
  dayLow: number
  brokeH: boolean
  brokeL: boolean
  touchH: boolean
  touchL: boolean
  openType: OpenType | null
  fvg: 'bull' | 'bear' | null
  volSurge: boolean | null
  failed: boolean | null
  retest: boolean
  retestCont: boolean | null
  containedAt2: boolean | null
  extHit1: boolean
  pdh: number | null
  pdl: number | null
  dayOpen: number
}

export type LiveState = LivePending | LiveSession

/** The two trailing averages the width class needs, plus a field nothing reads. */
export interface IbHist {
  avgIb: number
  avgAtr: number
  /**
   * Computed at `IbStatsTab.tsx:1561` and READ BY NOTHING. Kept in the type so
   * the shape matches v2's prop; step 3 may drop it.
   */
  dowStats: { name: string; n: number; sb: number | null }[]
}

/**
 * The `hist` prop (`IbStatsTab.tsx:1558–1564`).
 *
 * THE LAST 20 SESSIONS OF THE STATIC EXPORT, not the last 20 real sessions —
 * with LAST_UPDATED at 7/11/2026 these averages are frozen at export time.
 *
 * v2 built this as a fresh OBJECT LITERAL on every render, and it is a dependency
 * of the `live` useMemo, so the whole live computation re-ran every render (G64).
 * v3 must memoise the result of this call, or pass the two scalars.
 */
export function buildHist(days: readonly SlimDay[], byDowNames: readonly { name: string; g: SlimDay[] }[] = []): IbHist {
  const tail = days.slice(-20)
  return {
    avgIb: avg(tail.map((d) => d.width)) ?? 0,
    avgAtr: avg(tail.map((d) => d.atr ?? d.dayRange)) ?? 0,
    dowStats: byDowNames.map(({ name, g }) => ({
      name,
      n: g.length,
      sb: rateNum(g.filter((d) => d.singleBreak).length, g.length),
    })),
  }
}

/** The live `status` ladder (`:286–292`). Ordered; first match wins. */
export const LIVE_STATUS = {
  forming: 'IB still forming',
  rotation: 'BOTH sides broken — rotation',
  brokeHigh: 'Broken HIGH',
  brokeLow: 'Broken LOW',
  wicked: 'Wicked out, no close outside',
  inside: 'Inside IB',
} as const

/**
 * Everything the rules need about the session that is actually running.
 * `IbStatsTab.tsx:212–384`, transcribed step for step.
 *
 * Returns null when there are no RTH bars at all, `{ pending: true }` before the
 * first range bar prints, and the full session otherwise.
 *
 * `historical` is the DB-loaded prior-session array; it is used ONLY as the
 * fallback for pdh/pdl when the live tape carries no prior-dated bars.
 */
export function computeLiveSession(
  candles: readonly IbCandle[] | null | undefined,
  historical: readonly IbCandle[] | null | undefined,
  hist: IbHist,
  win: IbWindow,
): LiveState | null {
  if (!candles?.length) return null
  const rEnd = rangeEnd(win)

  // Group by TRUE ET session date — filtering on minute-of-day alone would blend
  // yesterday's RTH into today's range (v2's comment at :213–214).
  const all: IbBar[] = candles
    .map((c) => ({
      day: etDate(c.timestamp),
      min: etMin(c.timestamp),
      h: c.high,
      l: c.low,
      c: c.close,
      o: c.open,
      v: c.volume ?? 0,
    }))
    .filter((b) => b.min >= RTH_OPEN && b.min <= RTH_CLOSE)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.min - b.min))
  const newest = all[all.length - 1]
  if (!newest) return null

  const today = newest.day
  const bars = all.filter((b) => b.day === today)
  const priorBars = all.filter((b) => b.day < today)

  let pdh: number | null = priorBars.length ? Math.max(...priorBars.map((b) => b.h)) : null
  let pdl: number | null = priorBars.length ? Math.min(...priorBars.map((b) => b.l)) : null
  if (pdh == null || pdl == null) {
    const histRth = (historical ?? [])
      .map((c) => ({ day: etDate(c.timestamp), min: etMin(c.timestamp), h: c.high, l: c.low }))
      .filter((b) => b.min >= RTH_OPEN && b.min <= RTH_CLOSE && b.day < today)
    const seed = histRth[0]
    if (seed) {
      const priorDay = histRth.reduce((m, b) => (b.day > m ? b.day : m), seed.day)
      const pr = histRth.filter((b) => b.day === priorDay)
      pdh = Math.max(...pr.map((b) => b.h))
      pdl = Math.min(...pr.map((b) => b.l))
    }
  }

  // `< rEnd` is EXCLUSIVE — the range-end bar is already post-range.
  const ibBars = bars.filter((b) => b.min >= RTH_OPEN && b.min < rEnd)
  const post = bars.filter((b) => b.min >= rEnd)
  const last = bars[bars.length - 1]
  if (!last) return null
  const nowMin = last.min
  const ibComplete = nowMin >= rEnd

  if (!ibBars.length) return { pending: true, nowMin, price: last.c }

  const ibh = Math.max(...ibBars.map((b) => b.h))
  const ibl = Math.min(...ibBars.map((b) => b.l))
  const width = ibh - ibl
  const mid = (ibh + ibl) / 2
  const lastIb = ibBars[ibBars.length - 1]
  const ibClose = lastIb ? lastIb.c : last.c

  const first = firstFormedLive(ibBars, ibh, ibl)
  const bias = biasOf(ibClose, mid)
  // No guard on `width <= 0`: a zero-width range divides by zero and `loc` falls
  // to the ternary's 0.5, which lands in "mid50".
  const loc = closeLoc(ibClose, ibl, width)

  const brokeH = post.some((b) => b.c > ibh)
  const brokeL = post.some((b) => b.c < ibl)
  const touchH = post.some((b) => b.h > ibh)
  const touchL = post.some((b) => b.l < ibl)

  // The FIRST post bar whose CLOSE is outside. High is checked before low within
  // the same bar, so an outside bar that closes through both records "H".
  let breakSide: 'H' | 'L' | null = null
  let breakMin: number | null = null
  for (const b of post) {
    if (b.c > ibh) {
      breakSide = 'H'
      breakMin = b.min
      break
    }
    if (b.c < ibl) {
      breakSide = 'L'
      breakMin = b.min
      break
    }
  }

  const price = last.c
  const dayHigh = Math.max(...bars.map((b) => b.h))
  const dayLow = Math.min(...bars.map((b) => b.l))

  const status = !ibComplete
    ? LIVE_STATUS.forming
    : brokeH && brokeL
      ? LIVE_STATUS.rotation
      : brokeH
        ? LIVE_STATUS.brokeHigh
        : brokeL
          ? LIVE_STATUS.brokeLow
          : touchH || touchL
            ? LIVE_STATUS.wicked
            : LIVE_STATUS.inside

  const bucket = widthClassLive(width, hist.avgAtr, hist.avgIb)

  // Extension targets, measured from the broken level against the WHOLE day's
  // high/low — including bars printed BEFORE the break.
  const lvl = breakSide === 'H' ? ibh : breakSide === 'L' ? ibl : null
  const targets: LiveTarget[] =
    lvl != null && breakSide
      ? EXT_MULTIPLES.map((t) => ({
          t,
          px: breakSide === 'H' ? lvl + t * width : lvl - t * width,
          hit: breakSide === 'H' ? dayHigh >= lvl + t * width : dayLow <= lvl - t * width,
        }))
      : []

  // Inner ORB: first close outside the 09:30–09:45 range, still inside the
  // opening range. Only meaningful when the window is longer than 15m, so on the
  // 15m and 5m tabs `orbDir` is always null and rule 12 goes not-in-play.
  const orb = win > 15 ? ibBars.filter((b) => b.min < 585) : []
  let orbDir: 'H' | 'L' | null = null
  if (orb.length) {
    const orbH = Math.max(...orb.map((b) => b.h))
    const orbL = Math.min(...orb.map((b) => b.l))
    for (const b of ibBars.filter((x) => x.min >= 585)) {
      if (b.c > orbH) {
        orbDir = 'H'
        break
      }
      if (b.c < orbL) {
        orbDir = 'L'
        break
      }
    }
  }

  const firstBar = bars[0]
  const dayOpen = firstBar ? firstBar.o : price
  const openType = openTypeOf(dayOpen, pdh, pdl)

  // 15m candles rebuilt by MINUTE WINDOW from the range bars. NOTE there is no
  // `break` in the scan: the LAST qualifying gap wins, not the first.
  const b15: { h: number; l: number }[] = []
  for (let s = RTH_OPEN; s < rEnd; s += 15) {
    const g = ibBars.filter((b) => b.min >= s && b.min < s + 15)
    if (g.length) b15.push({ h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) })
  }
  let fvg: 'bull' | 'bear' | null = null
  for (let i = 2; i < b15.length; i++) {
    const cur = b15[i]
    const two = b15[i - 2]
    if (!cur || !two) continue
    if (cur.l > two.h) fvg = 'bull'
    else if (cur.h < two.l) fvg = 'bear'
  }

  const bIdx = breakMin != null ? post.findIndex((b) => b.min === breakMin) : -1
  const brk = bIdx >= 0 ? (post[bIdx] ?? null) : null
  const after = bIdx >= 0 ? post.slice(bIdx + 1) : []
  const ibVol = avg(ibBars.map((b) => b.v)) ?? 0
  const volSurge = brk && ibVol > 0 ? brk.v > ibVol : null

  // Rule 6 — closes back inside within 30 CLOCK MINUTES of the break. The
  // dataset uses SIX BARS (`lib/ibStats.ts:282`), which is the same thing only
  // at 5m bars.
  const failed = brk
    ? after
        .filter((b) => b.min <= brk.min + 30)
        .some((b) => (breakSide === 'H' ? b.c < ibh : b.c > ibl))
    : null

  const lvlPx = breakSide === 'H' ? ibh : breakSide === 'L' ? ibl : null
  const rt: RetestRead =
    lvlPx != null && brk && breakSide ? retestLive(after, breakSide, lvlPx) : { retest: false, retestCont: null }

  const containedAt2 = containedAtTwoLive(bars, nowMin, rEnd, ibh, ibl)
  const extHit1 = targets.find((t) => t.t === 1)?.hit ?? false

  return {
    pending: false,
    today,
    nowMin,
    price,
    ibh,
    ibl,
    mid,
    width,
    ibComplete,
    first,
    bias,
    closeZone: closeZoneProse(loc),
    zone: closeZoneOf(loc),
    orbDir,
    status,
    bucket,
    breakSide,
    breakMin,
    targets,
    dayHigh,
    dayLow,
    brokeH,
    brokeL,
    touchH,
    touchL,
    openType,
    fvg,
    volSurge,
    failed,
    retest: rt.retest,
    retestCont: rt.retestCont,
    containedAt2,
    extHit1,
    pdh,
    pdl,
    dayOpen,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 1 — "LIVE READ". Spec rows G77–G116.
// ─────────────────────────────────────────────────────────────────────────────

export interface SampleGroup {
  g: SlimDay[]
  label: string
}

/**
 * The tightest condition stack that still has ≥ MIN_N sessions (`:455–461`).
 * Walks from the FULL stack down to one condition and takes the first group that
 * qualifies; the label is the same prefix of `labels`, joined with " + ".
 *
 * Nothing qualifying → the WHOLE dataset under the label "all sessions", which
 * is the only signal on screen that the reading is unconditioned.
 */
export function bestSample(
  days: readonly SlimDay[],
  conds: readonly ((d: SlimDay) => boolean)[],
  labels: readonly string[],
): SampleGroup {
  for (let i = conds.length; i > 0; i--) {
    const slice = conds.slice(0, i)
    const g = days.filter((d) => slice.every((c) => c(d)))
    if (g.length >= MIN_N) return { g, label: labels.slice(0, i).join(' + ') }
  }
  return { g: days as SlimDay[], label: ALL_SESSIONS_LABEL }
}

export const ALL_SESSIONS_LABEL = 'all sessions'

/**
 * The ordered condition stack the Live Read card conditions on (`:513–519`):
 *
 *   1. bias        — "close > mid" / "close < mid"   (omitted when bias is null)
 *   2. first       — "HIGH first" / "LOW first"      (ALWAYS present)
 *   3. widthBucket — e.g. "NARROW IB 60m"            (omitted when the bucket is null)
 *   4. orbDir      — "inner ORB up" / "inner ORB down" (omitted when null)
 */
export function liveConditionStack(
  live: LiveSession,
  win: IbWindow,
): { conds: ((d: SlimDay) => boolean)[]; labels: string[] } {
  const L = winLabel(win)
  const conds: ((d: SlimDay) => boolean)[] = []
  const labels: string[] = []
  const bias = live.bias
  if (bias) {
    conds.push((d) => d.bias === bias)
    labels.push(bias === 'H' ? 'close > mid' : 'close < mid')
  }
  const first = live.first
  conds.push((d) => d.first === first)
  labels.push(`${first === 'H' ? 'HIGH' : 'LOW'} first`)
  const bucketKey = bucketKeyOf(live.bucket)
  if (bucketKey) {
    conds.push((d) => d.widthBucket === bucketKey)
    labels.push(`${live.bucket} ${L}`)
  }
  const orbDir = live.orbDir
  if (orbDir) {
    conds.push((d) => d.orbDir === orbDir)
    labels.push(`inner ORB ${orbDir === 'H' ? 'up' : 'down'}`)
  }
  return { conds, labels }
}

/**
 * `String(live.bucket).toLowerCase()` (`:508`, `:688`). "—" lower-cases to "—",
 * which matches no bucket — that is how a missing width class disables rule 4
 * and drops condition 3 from the stack.
 */
export function bucketKeyOf(bucket: WidthWord): WidthBucket | null {
  const k = bucket.toLowerCase()
  return k === 'narrow' || k === 'normal' || k === 'wide' ? k : null
}

/**
 * P(the HIGH is touched first) over a group, in percent (`:522–523`).
 *
 * NO MEASUREMENT → 50. A group in which no session ever recorded a first touch
 * returns a hard-coded coin flip that is visually identical to a measured 50%.
 */
export function pHighOf(g: readonly SlimDay[]): number {
  const withTouch = g.filter((d) => d.firstTouchSide)
  if (!withTouch.length) return 50
  return (100 * withTouch.filter((d) => d.firstTouchSide === 'H').length) / withTouch.length
}

/**
 * The expansion-matrix population (`:525–531`): the group's sessions for TODAY's
 * weekday when there are at least MIN_N of them, else the whole group. Dates are
 * parsed at noon UTC so no timezone can shift the weekday; on a weekend
 * `dowIdx` is 0 or 6, `dowDays` is empty, and the fallback fires.
 */
export function expansionPopulation(g: readonly SlimDay[], dowIdx: number): SlimDay[] {
  const dowDays = dowIdx >= 1 && dowIdx <= 5 ? g.filter((d) => dowOf(d) === dowIdx) : []
  return dowDays.length >= MIN_N ? dowDays : (g as SlimDay[])
}

export interface ExpansionMatrix {
  pSingle: number
  pBoth: number
  pNone: number
  /** The one-line read under the bars. Boundary is a strict `>` at 32. */
  caption: string
}

/** The three bars are mutually exclusive by construction and sum to 100. */
export function expansionMatrix(mx: readonly SlimDay[]): ExpansionMatrix {
  const denom = mx.length || 1
  const pBoth = (100 * mx.filter((d) => d.bothBroke).length) / denom
  return {
    pSingle: (100 * mx.filter((d) => d.singleBreak).length) / denom,
    pBoth,
    pNone: (100 * mx.filter((d) => d.neitherBroke).length) / denom,
    caption: pBoth > ROTATION_RISK_PCT ? EXPANSION_CAPTION.high : EXPANSION_CAPTION.low,
  }
}

/** The only place this number appears in v2 (`:617`). */
export const ROTATION_RISK_PCT = 32

export const EXPANSION_CAPTION = {
  high: 'Rotational risk HIGH — expect a two-sided day',
  low: 'One-sided break expected — opposite extreme protected',
} as const

export const EXPANSION_LABELS = {
  title: 'Expansion matrix',
  single: 'Single-side trend',
  both: 'Rotational chop (both)',
  none: 'Contained range (none)',
} as const

/** The three bar colours (`:613–615`). Cyan / purple / warn — not a rate ladder. */
export const EXPANSION_COLORS = {
  single: V2.cyan,
  both: V2.purple,
  none: V2.orange,
} as const

export type TacticalVerdict = 'tradeable' | 'fade' | 'noise'

export interface ActiveRule {
  name: string
  /** Set by every branch and RENDERED BY NOTHING — sample counts are owner-only. */
  n: number
  p: number
  verdict: TacticalVerdict
  note: string
}

/**
 * THE ACTIVE TACTICAL RULE (`:536–560`), evaluated in this exact order:
 *
 *   (a) a break printed BEFORE the range closed → null. Dead in practice: `post`
 *       starts at REND, so a break cannot exist before the range is complete.
 *   (b) both sides broken       → rotation, verdict "fade".
 *   (c) a break printed         → see below.
 *   (d) a bias only             → the midpoint read.
 *   (e) no bias                 → "No bias — … closed on the midpoint".
 *
 * Branch (c): group by break side AND width bucket; if that group is under
 * MIN_N, fall back to break side alone. Then
 *   failP > 50 → "fails more often than it runs", verdict "fade", and the
 *                DISPLAYED p is `100 - failP` — the success rate of the FADE,
 *                not the failure rate quoted in its own note;
 *   otherwise  → verdict "tradeable" at p >= 55, else "noise". There is NO
 *                "fade" outcome on this path however low p is.
 */
export function activeRule(
  live: LiveSession,
  days: readonly SlimDay[],
  group: SampleGroup,
  mx: readonly SlimDay[],
  pBoth: number,
  pHigh: number,
  win: IbWindow,
): ActiveRule | null {
  const L = winLabel(win)
  const bucketKey = bucketKeyOf(live.bucket)
  const fcb = days.filter((d) => d.fcb)

  if (live.breakSide && !live.ibComplete) return null

  if (live.brokeH && live.brokeL) {
    return {
      name: 'BOTH SIDES BROKEN — rotation day',
      n: mx.length,
      p: pBoth,
      verdict: 'fade',
      note: "Rotation day — fade the extremes, don't chase",
    }
  }

  if (live.breakSide) {
    const side = live.breakSide
    const grp = fcb.filter((d) => d.fcb?.side === side && d.widthBucket === bucketKey)
    const use = grp.length >= MIN_N ? grp : fcb.filter((d) => d.fcb?.side === side)
    const denom = use.length || 1
    const cont = use.filter((d) => d.fcb?.hit['1']).length
    const failP = (100 * use.filter((d) => d.fcb?.failed).length) / denom
    const p = (100 * cont) / denom
    const W = side === 'H' ? 'HIGH' : 'LOW'
    return failP > 50
      ? {
          name: `${W} break — fails more often than it runs`,
          n: use.length,
          p: 100 - failP,
          verdict: 'fade',
          note: `${failP.toFixed(1)}% of these breaks close back inside within 30m`,
        }
      : {
          name: `${W} break confirmed → ≥1× ext`,
          n: use.length,
          p,
          verdict: p >= 55 ? 'tradeable' : 'noise',
          note: `fail rate ${failP.toFixed(1)}%`,
        }
  }

  if (live.bias) {
    const use = group.g.filter((d) => d.firstTouchSide)
    const p = live.bias === 'H' ? pHigh : 100 - pHigh
    return {
      name: `Midpoint bias → ${live.bias === 'H' ? 'HIGH' : 'LOW'} breaks first`,
      n: use.length,
      p,
      verdict: p >= 60 ? 'tradeable' : p <= 45 ? 'fade' : 'noise',
      note: group.label,
    }
  }

  return {
    name: `No bias — ${L} closed on the midpoint`,
    n: group.g.length,
    p: 50,
    verdict: 'noise',
    note: 'wait for a break',
  }
}

/** The three verdict headlines (`:627`) and the colour each takes (`:576`). */
export const TACTICAL_VERDICT_TEXT: Record<TacticalVerdict, string> = {
  tradeable: 'TRADEABLE EDGE',
  fade: 'FADE SETUP',
  noise: 'NO EDGE',
}

/** A NULL rule paints the warn colour, same as "noise". */
export function tacticalVerdictColor(v: TacticalVerdict | null | undefined): string {
  return v === 'tradeable' ? V2.up : v === 'fade' ? V2.red : V2.orange
}

/**
 * THE OVERALL SCORE (`:563–572`), applied strictly in this order:
 *
 *   s  = (pHigh − 50) × 1.6
 *   +22 / −22   for a one-sided close break
 *   ×0.4        when BOTH sides broke (rotation kills conviction)
 *   ±6          price vs the midpoint      ← AFTER the ×0.4, so undamped by it
 *   ±4          the midpoint bias          ← likewise
 *   ×0.5        while the range is still forming (this one damps everything)
 *   clamped to [−100, +100]
 */
export function overallScore(live: LiveSession, pHigh: number): number {
  let s = (pHigh - 50) * 1.6
  if (live.brokeH && !live.brokeL) s += 22
  if (live.brokeL && !live.brokeH) s -= 22
  if (live.brokeH && live.brokeL) s *= 0.4
  if (live.price > live.mid) s += 6
  else if (live.price < live.mid) s -= 6
  if (live.bias === 'H') s += 4
  else if (live.bias === 'L') s -= 4
  if (!live.ibComplete) s *= 0.5
  return Math.max(-100, Math.min(100, s))
}

export type Conviction = 'STRONG' | 'LEAN' | 'NEUTRAL'

/** Both boundaries `>=`, on the absolute score (`:574`). */
export function convictionOf(score: number): Conviction {
  const a = Math.abs(score)
  return a >= 45 ? 'STRONG' : a >= 20 ? 'LEAN' : 'NEUTRAL'
}

/**
 * The verdict headline (`:590`). Five possible strings.
 * A score of exactly 0 is `bull` AND `NEUTRAL`, so it reads "NEUTRAL — no edge"
 * and paints the warn colour.
 */
export function overallVerdictText(score: number): string {
  const strength = convictionOf(score)
  if (strength === 'NEUTRAL') return 'NEUTRAL — no edge'
  return `${strength} ${score >= 0 ? 'BULLISH' : 'BEARISH'} BREAK`
}

export function overallVerdictColor(score: number): string {
  if (convictionOf(score) === 'NEUTRAL') return V2.orange
  return score >= 0 ? V2.up : V2.red
}

/** Signed integer, e.g. "+37" / "-8". The minus is the ASCII one `toFixed` emits. */
export function scoreText(score: number): string {
  return `${score >= 0 ? '+' : ''}${score.toFixed(0)}`
}

/**
 * THE LIVE READ GAUGE (`:463–488`) — SVG user units inside a fixed
 * `viewBox="0 0 100 50"`, not CSS pixels.
 *
 * BUG (v2): `arc` is 125 ≈ π·40, THE LENGTH OF THE FULL SEMICIRCLE, and it is
 * applied as the `strokeDasharray` of QUARTER-arc paths whose real length is
 * ≈ 62.8. The visible length therefore saturates at pHigh = 50: the winning
 * side's arc is fully drawn for every reading past the middle and only the
 * losing side's arc actually varies. Ported as written — the fix changes what
 * the gauge looks like, so it is a design call (Q5), not a bug fix. See
 * docs/parity/scanner.md Part G, rows G94–G95.
 */
export const LIVE_GAUGE = {
  viewBox: '0 0 100 50',
  trackPath: 'M 10 50 A 40 40 0 0 1 90 50',
  upPath: 'M 10 50 A 40 40 0 0 1 50 10',
  downPath: 'M 50 10 A 40 40 0 0 1 90 50',
  strokeWidth: 10,
  /** π·40, the SEMICIRCLE length, on a quarter arc. See the BUG note above. */
  arc: 125,
  needle: { x1: 50, y1: 50, x2: 50, y2: 15, strokeWidth: 2.5 },
  hub: { cx: 50, cy: 50, r: 4.5 },
  /** The needle and hub are v2's only raw `#fff` literals; both are T.text here. */
  needleColor: T.text,
  /** Below this |pHigh − 50| the label reads "NO DIRECTIONAL EDGE". Strict `<`. */
  deadBand: 2,
} as const

/** `-90°` at pHigh 0, `0°` at 50, `+90°` at 100. */
export const gaugeAngle = (pHigh: number): number => -90 + (pHigh / 100) * 180

/** Dash offset for one arc, per v2's formula (saturating — see LIVE_GAUGE). */
export const gaugeDashOffset = (fraction: number): number =>
  LIVE_GAUGE.arc - LIVE_GAUGE.arc * fraction

/**
 * The big number under the needle is ALWAYS THE WINNING SIDE'S probability
 * (`:481`), so it can never read below 50.0%.
 */
export const gaugeReadout = (pHigh: number): number => (pHigh >= 50 ? pHigh : 100 - pHigh)

/**
 * The label under it (`:483–485`). Note the COLOUR is not neutralised inside the
 * dead band — a 49.5% reading still paints the down colour while saying
 * "NO DIRECTIONAL EDGE".
 */
export function gaugeVerdict(pHigh: number): { text: string; color: string } {
  const hiSide = pHigh >= 50
  const text =
    Math.abs(pHigh - 50) < LIVE_GAUGE.deadBand
      ? 'NO DIRECTIONAL EDGE'
      : hiSide
        ? 'HIGH BREAK BIAS'
        : 'LOW BREAK BIAS'
  return { text, color: hiSide ? V2.up : V2.red }
}

/** Every fixed string on the Live Read card. */
export const LIVE_READ_TEXT = {
  title: (win: IbWindow): string => `Live Read — direction, expansion, active rule · ${winLabel(win)}`,
  /** The subtitle is the surviving condition stack, plus a forming suffix. */
  subtitle: (label: string, ibComplete: boolean, win: IbWindow): string =>
    `${label}${ibComplete ? '' : ` · ${winLabel(win)} STILL FORMING`}`,
  overallLabel: 'Overall break bias',
  /** U+2212 minus and a single U+2026 ellipsis — unlike the score above it. */
  scoreCaption: '−100 bear … +100 bull',
  gaugeTitle: 'Breakout target bias',
  highFirst: 'High first ',
  lowFirst: 'Low first ',
  activeRuleTitle: 'Active tactical rule',
  edgeRate: 'Edge rate',
  /** HARDCODED to 10:30 — it does not follow the window selector (G110). */
  waiting: 'Waiting on the 10:30 ET close.',
} as const

/** The two early-return cards LiveToday renders instead of the trio (G53, G54). */
export const LIVE_EMPTY_TEXT = {
  noBarsTitle: (sym: IbSymbol): string => `Today — ${sym}`,
  noBarsSubtitleConnected: "Waiting for today's bars…",
  noBarsSubtitleOffline: 'Candle feed disconnected',
  noBarsBody: 'No RTH bars yet for the current session. This card fills in from 09:30 ET.',
  pendingTitle: (sym: IbSymbol, dowName: string): string => `Today — ${sym} · ${dowName}`,
  pendingSubtitle: (win: IbWindow): string =>
    `Pre-range — ${winLabel(win)} levels set at ${clock(rangeEnd(win))} ET`,
  pendingPriceKey: 'Live price',
  pendingClockKey: 'Clock (ET)',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// `buildRules` — THE 15 LIVE RULES AND EVERY STRING THEY EMIT.
// Spec rows G204–G218. One function feeding three surfaces: the IB Read
// families, the Probability Engine gauges, and the dead RuleBoard.
// ─────────────────────────────────────────────────────────────────────────────

export type RuleState = 'in-play' | 'not-in-play' | 'pending'

export interface LiveRule {
  id: string
  name: string
  state: RuleState
  /** What today actually shows. */
  read: string
  /** The direction the rule points, if any. */
  side: 'H' | 'L' | null
  /** What the percentage measures. */
  question: string
  /** A not-in-play rule has NO cond/outcome, hence n = 0, p = null, last5 = []. */
  cond?: (d: SlimDay) => boolean
  outcome?: (d: SlimDay) => boolean
}

/** The shared "no break yet" phrase (`:701`). */
export const NO_BREAK_READ = 'no close-confirmed break yet — odds below are for IF it fires'

const W = (s: 'H' | 'L'): string => (s === 'H' ? 'HIGH' : 'LOW')

/**
 * The 14 numbered rules plus `0c`, in push order (`IbStatsTab.tsx:681–942`).
 *
 * `exp = bias ?? first` is the side the range leans toward; every PENDING branch
 * is scored on it, i.e. "if it fires, here is what sessions that looked like this
 * one did".
 *
 * `dowName` is the BROWSER-LOCAL weekday (see DOW_NAMES) — rule 0c is pushed
 * only Monday–Friday, and on a weekend the "Timing, Width & Day Type" family
 * simply has four members with no message.
 */
export function buildRules(live: LiveSession, dowName: string, win: IbWindow): LiveRule[] {
  const L = winLabel(win)
  const rEnd = rangeEnd(win)
  const bias = live.bias
  const first = live.first
  const zone = live.zone
  const bucket = live.bucket
  const bk = bucketKeyOf(bucket)
  const orbDir = live.orbDir
  const brk = live.breakSide
  const openType = live.openType
  const fvg = live.fvg
  const dowIdx = DOW_NAMES.indexOf(dowName as (typeof DOW_NAMES)[number])
  const zoneWord = ZONE_WORD[zone]
  const confluent = !!bias && ((first === 'L' && bias === 'H') || (first === 'H' && bias === 'L'))
  const exp: 'H' | 'L' = bias ?? first
  const R: LiveRule[] = []

  /* 1 · Midpoint Close Bias */
  R.push(
    bias
      ? {
          id: '1',
          name: 'Midpoint Close Bias',
          state: 'in-play',
          read: `${L} closed ${bias === 'H' ? 'ABOVE' : 'BELOW'} mid → lean ${bias === 'H' ? 'LONG' : 'SHORT'}`,
          side: bias,
          question: `${W(bias)} breaks first`,
          cond: (d) => d.bias === bias,
          outcome: (d) => d.firstTouchSide === bias,
        }
      : {
          id: '1',
          name: 'Midpoint Close Bias',
          state: 'not-in-play',
          read: `${L} closed exactly ON the midpoint — no bias`,
          side: null,
          question: EM_DASH,
        },
  )

  /* 2 · Formation Order + Midpoint */
  R.push(
    bias && confluent
      ? {
          id: '2',
          name: 'Formation Order + Midpoint',
          state: 'in-play',
          read: `${W(first)} formed first + close ${bias === 'H' ? 'above' : 'below'} mid — CONFLUENT (the A+ filter)`,
          side: bias,
          question: `${W(bias)} breaks first`,
          cond: (d) => d.bias === bias && d.first === first,
          outcome: (d) => d.firstTouchSide === bias,
        }
      : {
          id: '2',
          name: 'Formation Order + Midpoint',
          state: 'not-in-play',
          read: bias
            ? `${W(first)} formed first + close ${bias === 'H' ? 'above' : 'below'} mid — DISCORDANT, the rule says skip`
            : 'no midpoint bias to align with',
          side: null,
          question: EM_DASH,
        },
  )

  /* 3 · Single Break Continuation */
  R.push(
    brk
      ? {
          id: '3',
          name: 'Single Break Continuation',
          state: 'in-play',
          read: `Broke the ${W(brk)} — does the other side stay untouched?`,
          side: brk,
          question: `${brk === 'H' ? 'LOW' : 'HIGH'} never breaks (stays a single-break day)`,
          cond: (d) => !!d.fcb && d.fcb.side === brk,
          outcome: (d) => (d.fcb?.side === 'H' ? !d.touchedL : !d.touchedH),
        }
      : {
          id: '3',
          name: 'Single Break Continuation',
          // PENDING, not "not-in-play" — the odds for the break that has not
          // printed are exactly what you want on screen beforehand.
          state: 'pending',
          read: `${NO_BREAK_READ} — projected side: ${W(exp)}`,
          side: exp,
          question: `IF the ${W(exp)} breaks, the ${exp === 'H' ? 'LOW' : 'HIGH'} never does`,
          cond: (d) => !!d.fcb && d.fcb.side === exp,
          outcome: (d) => (exp === 'H' ? !d.touchedL : !d.touchedH),
        },
  )

  /* 4 · Range Width → Day Type */
  R.push(
    bk
      ? {
          id: '4',
          name: `${L} Width → Day Type`,
          state: 'in-play',
          read: `${bucket} ${L} (${f2(live.width)} pts) → ${
            bk === 'narrow'
              ? 'trend / breakout lean'
              : bk === 'wide'
                ? 'rotation lean — fade the breaks'
                : 'no width edge'
          }`,
          // side null → the Probability Engine files this rule under ROTATION.
          side: null,
          question: bk === 'wide' ? 'BOTH sides break (rotation)' : 'only ONE side breaks',
          cond: (d) => d.widthBucket === bk,
          outcome: (d) => (bk === 'wide' ? d.bothBroke : d.singleBreak),
        }
      : {
          id: '4',
          name: `${L} Width → Day Type`,
          state: 'not-in-play',
          read: 'width bucket unavailable — ATR14 / 20d avg range not yet established',
          side: null,
          question: EM_DASH,
        },
  )

  /* 5 · Breakout Entry + volume */
  R.push(
    brk && live.volSurge != null
      ? {
          id: '5',
          name: 'Breakout Entry — close + volume',
          state: 'in-play',
          read: live.volSurge
            ? `${W(brk)} break came WITH a volume surge (break bar > avg ${L} bar)`
            : `${W(brk)} break came with NO volume surge — the weaker version`,
          side: brk,
          question: `the break runs ≥ 1× ${L} width`,
          cond: (d) => !!d.fcb && d.fcb.volSurge === live.volSurge,
          outcome: (d) => !!d.fcb?.hit['1'],
        }
      : {
          id: '5',
          name: 'Breakout Entry — close + volume',
          state: 'pending',
          read: brk
            ? 'break printed but bar volume is unavailable on the live feed — showing the all-breaks rate'
            : `${NO_BREAK_READ} — projected side: ${W(exp)}`,
          side: exp,
          question: `IF a ${W(exp)} break prints WITH a volume surge, it runs ≥ 1× ${L} width`,
          cond: (d) => !!d.fcb && d.fcb.side === exp && d.fcb.volSurge,
          outcome: (d) => !!d.fcb?.hit['1'],
        },
  )

  /* 6 · Failed Breakout Fade — the side is INVERTED on both branches, so a HIGH
     break makes this rule vote BEARISH in the family and engine maths. */
  R.push(
    brk
      ? {
          id: '6',
          name: 'Failed Breakout Fade',
          state: 'in-play',
          read: live.failed
            ? `The ${W(brk)} break ALREADY FAILED — closed back inside. Fade target: mid, then the opposite extreme`
            : `${W(brk)} break is holding — this is the trap risk, not yet triggered`,
          side: brk === 'H' ? 'L' : 'H',
          question: live.failed
            ? `the fade reaches the OPPOSITE ${L} extreme`
            : 'this break fails and closes back inside ≤30m',
          cond: (d) => !!d.fcb && d.fcb.side === brk && (live.failed ? d.fcb.failed : true),
          outcome: (d) => (live.failed ? !!d.fcb?.fadeOpp : !!d.fcb?.failed),
        }
      : {
          id: '6',
          name: 'Failed Breakout Fade',
          state: 'pending',
          read: `${NO_BREAK_READ} — this is the trap rate to expect`,
          side: exp === 'H' ? 'L' : 'H',
          question: `IF a ${W(exp)} break prints, it FAILS back inside within 30m`,
          cond: (d) => !!d.fcb && d.fcb.side === exp,
          outcome: (d) => !!d.fcb?.failed,
        },
  )

  /* 7 · 15m FVG inside the range — impossible once the window is ≤ 15m */
  R.push(
    fvg
      ? {
          id: '7',
          name: `15m FVG inside the ${L}`,
          state: 'in-play',
          read: `${fvg === 'bull' ? 'BULLISH' : 'BEARISH'} 15m fair-value gap inside the ${L}`,
          side: fvg === 'bull' ? 'H' : 'L',
          question: `the ${fvg === 'bull' ? 'HIGH' : 'LOW'} is the side that gets touched first`,
          cond: (d) => d.fvg === fvg,
          outcome: (d) => d.firstTouchSide === (fvg === 'bull' ? 'H' : 'L'),
        }
      : {
          id: '7',
          name: `15m FVG inside the ${L}`,
          state: 'not-in-play',
          read:
            win <= 15
              ? `window is only ${win}m — a 15m FVG cannot form inside it. Use the 30m or 60m tab for this rule.`
              : `no 15m FVG formed inside today's ${L}`,
          side: null,
          question: EM_DASH,
        },
  )

  /* 8 · Retest Continuation. NOTE the in-play `cond` does NOT filter by break
     side — it pools HIGH and LOW retests, unlike the pending branch. */
  R.push(
    brk && live.retest
      ? {
          id: '8',
          name: 'Retest Continuation',
          state: 'in-play',
          read: `Price came back to the broken ${W(brk)} and ${live.retestCont ? 'held — continuation is live' : 'is still deciding'}`,
          side: brk,
          question: 'it continues to a new extreme after the retest',
          cond: (d) => !!d.fcb?.retest && d.fcb?.retestCont != null,
          outcome: (d) => !!d.fcb?.retestCont,
        }
      : {
          id: '8',
          name: 'Retest Continuation',
          state: 'pending',
          read: brk
            ? `no retest of the broken ${W(brk)} yet — odds below are for IF it comes back`
            : `${NO_BREAK_READ} — projected side: ${W(exp)}`,
          side: brk ?? exp,
          question: `IF the broken ${W(brk ?? exp)} is retested, it continues to a new extreme`,
          cond: (d) =>
            !!d.fcb && d.fcb.side === (brk ?? exp) && d.fcb.retest && d.fcb.retestCont != null,
          outcome: (d) => !!d.fcb?.retestCont,
        },
  )

  /* 9 · Extension Targets */
  R.push(
    brk
      ? {
          id: '9',
          name: 'Extension Targets',
          state: 'in-play',
          read: `Measuring from the broken ${W(brk)} — ${live.targets.filter((t) => t.hit).length}/${live.targets.length} targets reached`,
          side: brk,
          question: `the move reaches ≥ 1× ${L} width`,
          cond: (d) => !!d.fcb && d.fcb.side === brk,
          outcome: (d) => !!d.fcb?.hit['1'],
        }
      : {
          id: '9',
          name: 'Extension Targets',
          state: 'pending',
          read: `${NO_BREAK_READ} — targets would measure from the ${L} ${W(exp)} (${f2(exp === 'H' ? live.ibh : live.ibl)})`,
          side: exp,
          question: `IF a ${W(exp)} break prints, it reaches ≥ 1× ${L} width`,
          cond: (d) => !!d.fcb && d.fcb.side === exp,
          outcome: (d) => !!d.fcb?.hit['1'],
        },
  )

  /* 10 · Close Location in the range. The `&& bias` in the gate is redundant with
     `strongZone` in practice but can knock the rule out on an exactly-on-mid close. */
  const strongZone = (zone === 'top25' && first === 'L') || (zone === 'bot25' && first === 'H')
  R.push(
    strongZone && bias
      ? {
          id: '10',
          name: `Close Location in the ${L} Range`,
          state: 'in-play',
          read: `Close in the ${zoneWord} + ${W(first)} formed first — the strong ${zone === 'top25' ? 'LONG' : 'SHORT'} version`,
          side: zone === 'top25' ? 'H' : 'L',
          question: `${zone === 'top25' ? 'HIGH' : 'LOW'} breaks first`,
          cond: (d) => d.closeZone === zone && d.first === first,
          outcome: (d) => d.firstTouchSide === (zone === 'top25' ? 'H' : 'L'),
        }
      : {
          id: '10',
          name: `Close Location in the ${L} Range`,
          state: 'not-in-play',
          read:
            zone === 'mid50'
              ? `${L} closed in the MIDDLE 50% — no close-location edge`
              : `Close in the ${zoneWord} but ${W(first)} formed first — zone and formation order disagree`,
          side: null,
          question: EM_DASH,
        },
  )

  /* 11 · Open Type + range width */
  R.push(
    openType && bk
      ? {
          id: '11',
          name: `Open Type + ${L} Width`,
          state: 'in-play',
          read: `${openType} open (${openType.startsWith('OAR') ? 'outside' : 'inside'} the prior RTH range) + ${bucket} ${L}`,
          side: null,
          question: 'only ONE side breaks',
          cond: (d) => d.openType === openType && d.widthBucket === bk,
          outcome: (d) => d.singleBreak,
        }
      : {
          id: '11',
          name: `Open Type + ${L} Width`,
          state: 'not-in-play',
          // The ONLY message, even when the real cause is a missing width bucket.
          read: "prior-session RTH range unavailable on the live feed — open type can't be classified",
          side: null,
          question: EM_DASH,
        },
  )

  /* 12 · inner 09:30–09:45 ORB vs the midpoint bias — needs a window > 15m.
     The side is the BIAS in both branches: a conflicting ORB still votes the bias
     direction, it only changes the wording. */
  R.push(
    orbDir && bias
      ? {
          id: '12',
          name: `Inner 15m ORB + ${L} Alignment`,
          state: 'in-play',
          read:
            orbDir === bias
              ? `Inner 15m ORB broke ${W(orbDir)} — ALIGNED with the midpoint bias`
              : `Inner 15m ORB broke ${W(orbDir)} — CONFLICTS with the midpoint bias`,
          side: bias,
          question: `${W(bias)} breaks first`,
          cond: (d) => d.bias === bias && d.orbDir === orbDir,
          outcome: (d) => d.firstTouchSide === bias,
        }
      : {
          id: '12',
          name: `Inner 15m ORB + ${L} Alignment`,
          state: 'not-in-play',
          read:
            win <= 15
              ? `window is only ${win}m — there is no inner ORB to nest inside it. Use the 30m or 60m tab for this rule.`
              : !orbDir
                ? `the 09:30–09:45 opening range never broke inside the ${L}`
                : 'no midpoint bias to align with',
          side: null,
          question: EM_DASH,
        },
  )

  /* 13 · Time Filter */
  const bm = live.breakMin
  R.push(
    bm != null
      ? {
          id: '13',
          name: 'Time Filter — when the break happens',
          state: 'in-play',
          // BUG (v2): the WORD below is window-anchored (REND+30 / 780) while the
          // `cond` beneath it buckets on hardcoded 660 / 780. On ORB 5m a 10:10
          // break reads "midday" and scores "early". Both ladders ported as
          // written; see breakTimeWordInPlay / breakTimeBucketScored.
          read: `Break printed at ${clock(bm)} ET — ${breakTimeWordInPlay(bm, rEnd, L)}`,
          side: brk,
          question: `the break runs ≥ 1× ${L} width given that timing`,
          cond: (d) =>
            !!d.fcb && breakTimeBucketScored(d.fcb.breakMin) === breakTimeBucketScored(bm),
          outcome: (d) => !!d.fcb?.hit['1'],
        }
      : {
          id: '13',
          name: 'Time Filter — when the break happens',
          state: 'pending',
          read: `${NO_BREAK_READ} — it's ${clock(live.nowMin)} ET, so a break now counts as ${breakTimeWordPending(live.nowMin)}`,
          side: exp,
          question: `IF the break prints in this window, it runs ≥ 1× ${L} width`,
          cond: (d) =>
            !!d.fcb && breakTimeBucketScored(d.fcb.breakMin) === breakTimeBucketScored(live.nowMin),
          outcome: (d) => !!d.fcb?.hit['1'],
        },
  )

  /* 14 · Contained Day — a three-way gate */
  R.push(
    live.containedAt2 === true
      ? {
          id: '14',
          name: 'Contained Day (rare)',
          state: 'in-play',
          read: `Price is STILL fully inside the ${L} at 14:00 ET — the rare contained day`,
          side: null,
          question: 'it stays contained into the close (never breaks late)',
          cond: (d) => d.containedAt2,
          outcome: (d) => !d.containedBrokeLate,
        }
      : live.nowMin < TWO_PM && !live.brokeH && !live.brokeL
        ? {
            id: '14',
            name: 'Contained Day (rare)',
            state: 'pending',
            read: `Still inside the ${L} at ${clock(live.nowMin)} ET — not confirmed until 14:00`,
            side: null,
            question: 'IF price is still contained at 14:00, it never breaks late',
            cond: (d) => d.containedAt2,
            outcome: (d) => !d.containedBrokeLate,
          }
        : {
            id: '14',
            name: 'Contained Day (rare)',
            state: 'not-in-play',
            read: `price already broke the ${L} — not a contained day`,
            side: null,
            question: EM_DASH,
          },
  )

  /* 0c · day-of-week. Pushed ONLY Mon–Fri, always in-play, and absent from
     STAGE_DEFS so it never reaches the Probability Engine. */
  if (dowIdx >= 1 && dowIdx <= 5) {
    R.push({
      id: '0c',
      name: `Day of week — ${dowName}`,
      state: 'in-play',
      read: `It's ${dowName}`,
      side: null,
      question: 'only ONE side breaks',
      cond: (d) => dowOf(d) === dowIdx,
      outcome: (d) => d.singleBreak,
    })
  }

  return R
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 2 — "IB READ": scoring, the four families, the tape.
// Spec rows G117–G141.
// ─────────────────────────────────────────────────────────────────────────────

export type ScoredRule = LiveRule & { n: number; p: number | null; last5: boolean[] }

/**
 * Score every rule that has a condition against the dataset (`:947–955`).
 *
 * NO MINIMUM-SAMPLE GUARD ANYWHERE IN HERE. A rule matching 2 sessions reports
 * its rate with the same weight and the same colour as one matching 900, and the
 * Probability Engine is handed these numbers with `n` already stripped. That is
 * v2's behaviour, it is load-bearing on every pill and every gauge, and it is
 * preserved deliberately (Q8).
 *
 * `last5` is OLDEST → NEWEST, over the rule's last five IN-PLAY sessions.
 */
export function scoreWithHistory(rules: readonly LiveRule[], days: readonly SlimDay[]): ScoredRule[] {
  return rules.map((r) => {
    const cond = r.cond
    const outcome = r.outcome
    if (!cond || !outcome) return { ...r, n: 0, p: null, last5: [] }
    const g = days
      .filter(cond)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const hits = g.filter(outcome).length
    return {
      ...r,
      n: g.length,
      p: g.length ? (100 * hits) / g.length : null,
      last5: g.slice(-5).map((d) => outcome(d)),
    }
  })
}

export interface FamilyDef {
  key: string
  title: string
  sub: string
  ids: readonly string[]
  correlated?: boolean
  hero?: boolean
}

/**
 * The four families (`:978–983`). Members that resolve to nothing are dropped
 * silently. Rules 4, 11, 14 and 0c all carry `side: null`, so in "Timing, Width
 * & Day Type" only rule 13 can ever give the family a direction.
 */
export const FAMILIES: readonly FamilyDef[] = [
  {
    key: 'struct',
    title: 'Morning Structure Bias',
    sub: 'close vs mid · formation order · FVG · close location',
    ids: ['1', '2', '7', '10'],
    correlated: true,
  },
  {
    key: 'confirm',
    title: 'Break Confirmation',
    sub: 'what price actually did after the break',
    ids: ['3', '5', '6', '8', '9'],
  },
  {
    key: 'timing',
    title: 'Timing, Width & Day Type',
    sub: 'whether one side runs, and how far',
    ids: ['4', '11', '13', '14', '0c'],
  },
  {
    key: 'conflict',
    title: 'Conflict Watch',
    sub: 'faster structure vs the morning lean',
    ids: ['12'],
    hero: true,
  },
]

/** The two badge strings (`:1065`); families 2 and 3 have no badge. */
export const FAMILY_BADGE = {
  hero: 'early tell',
  correlated: 'correlated · 1 idea',
} as const

export interface FamilyStat {
  members: ScoredRule[]
  netSide: 'H' | 'L' | null
  avg: number | null
}

/**
 * A family's net direction (`:985–994`).
 *
 * SUMS OF PERCENTAGES, NOT WEIGHTED BY SAMPLE SIZE. Ties resolve to "H" —
 * including `0 === 0` when `dir` is non-empty but every rate is 0. `avg` is the
 * mean rate of the members on the winning side only.
 */
export function familyStat(scored: readonly ScoredRule[], ids: readonly string[]): FamilyStat {
  const members = ids
    .map((id) => scored.find((r) => r.id === id))
    .filter((r): r is ScoredRule => !!r)
  const dir = members.filter((r) => r.side && r.p != null)
  const sumH = dir.filter((r) => r.side === 'H').reduce((s, r) => s + (r.p || 0), 0)
  const sumL = dir.filter((r) => r.side === 'L').reduce((s, r) => s + (r.p || 0), 0)
  const netSide: 'H' | 'L' | null = dir.length ? (sumH >= sumL ? 'H' : 'L') : null
  const onSide = dir.filter((r) => r.side === netSide)
  const mean = onSide.length ? onSide.reduce((s, r) => s + (r.p || 0), 0) / onSide.length : null
  return { members, netSide, avg: mean }
}

/** The family verdict word and its colour (`:1055–1056`). Arrows are U+2191/U+2193. */
export function familyVerdict(netSide: 'H' | 'L' | null): { text: string; color: string } {
  if (netSide == null) return { text: 'CONTEXT', color: V2.orange }
  return netSide === 'H' ? { text: 'HIGH ↑', color: V2.up } : { text: 'LOW ↓', color: V2.red }
}

/** One session on the "LAST 5 SESSIONS" tape. */
export interface TapeDay {
  date: string
  firstTouchSide: 'H' | 'L' | null
  neitherBroke?: boolean
  bothBroke?: boolean
  singleBreak?: boolean
}

/** The tape's static fallback: the newest five rows of the export, oldest first. */
export function fallbackTape(days: readonly SlimDay[]): TapeDay[] {
  return days
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-5)
}

/**
 * The tape chip's three fields (`:1038–1045`).
 *
 * `dayType` is checked in exactly this order, and the whole chip falls back to a
 * dash. A tape sourced from the static export instead of the API is MONTHS OLD
 * and looks identical — that is v2's silent failure mode (G123).
 */
export function tapeChip(d: TapeDay): { color: string; date: string; dir: string; dayType: string } {
  const up = d.firstTouchSide === 'H'
  return {
    color: d.firstTouchSide == null ? V2.orange : up ? V2.up : V2.red,
    // "MM-DD". Assumes an ISO date; anything shorter silently truncates.
    date: d.date.slice(5),
    dir: d.firstTouchSide == null ? EM_DASH : up ? 'HIGH ↑' : 'LOW ↓',
    dayType: d.neitherBroke
      ? 'contained'
      : d.bothBroke
        ? 'both broke'
        : d.singleBreak
          ? 'single break'
          : EM_DASH,
  }
}

/** Hit / miss dot colours (`:958–970`). The miss dot also drops to 55% opacity. */
export const DOT = {
  hit: V2.up,
  miss: V2.red,
  hitTitle: 'hit',
  missTitle: 'miss',
  empty: 'no history',
} as const

export const IB_READ_TEXT = {
  /** A template literal with no interpolation in v2 — it says "IB" on every tab. */
  title: 'IB Read — 4 families, one glance',
  subtitleForming: (win: IbWindow): string =>
    `${winLabel(win)} STILL FORMING — conditional. Correlated rules grouped so one bias can't read as four votes; each pill shows its hit rate + last-5 outcomes.`,
  /** Says "14 rules"; the board carries 15 on a weekday (G119). */
  subtitleFormed:
    'The 14 rules grouped so correlated priors stop overcounting. Each pill shows its hit rate and last-5 outcomes; the strip up top is the recent tape.',
  tapeLabel: 'LAST 5 SESSIONS',
  avgConviction: 'avg conviction ',
  /**
   * The card footnote (`:1090–1092`). `<b>` in v2 on "Green dots = … red = wrong"
   * and on "Conflict Watch"; the apostrophe is &rsquo; and the arrow is U+2192.
   * Rendered as JSX, NOT dangerouslySetInnerHTML.
   */
  footnote:
    "Families collapse correlated rules so one bullish idea (close above mid · low-first · bullish structure) can’t read as four separate votes. Green dots = the rule was right on that past session, red = wrong (oldest → newest, its last 5 in-play sessions). The Conflict Watch card is the early tell: when the faster ORB structure disagrees with the morning lean, the lean is the stale one.",
  footnoteBold: ['Green dots = the rule was right on that past session, red = wrong', 'Conflict Watch'],
} as const

/**
 * The tape label and the section headers paint the tab accent — the ACCENT leg
 * of v2's #8ECAE6 collision, which is v2's own `LIGHT_BLUE` #7dd3fc ("the one
 * card accent", homeTheme.ts:88). This tab's body already accented in #7dd3fc
 * in v2; the tab pill now agrees with it (see `scannerNav.ts`).
 */
export const IB_READ_ACCENT = V2.accent

// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER-ONLY HISTORICAL CARDS.
// Spec rows G162–G203. Sixteen cards in fixed render order, all behind
// `isOwner && showStats`. Everything here is pure aggregation over `days`.
// ─────────────────────────────────────────────────────────────────────────────

/** One `Row` in a stats table (`IbStatsTab.tsx:125–138`). */
export interface StatRow {
  label: string
  n: number
  hits: number
  detail?: string
  indent?: boolean
}

/** One `Stat` tile (`:152–160`). */
export interface StatTile {
  k: string
  v: string
  sub?: string
}

/**
 * The rule-ranking verdict ladder (`:1545–1546`), checked in this order:
 *
 *   n < 20   → "thin sample"        ← SAMPLE SIZE WINS OVER RATE
 *   p >= 65  → "tradeable"
 *   p >= 55  → "marginal"
 *   p <= 45  → "inverted — fade it"
 *   else     → "noise"
 *
 * So 45 < p < 55 is noise, exactly 45 is inverted, exactly 55 is marginal, and a
 * 90%-on-9-days row reads "thin sample".
 */
export function verdict(n: number, p: number): string {
  if (n < SAMPLE_FLOORS.verdictThin) return 'thin sample'
  if (p >= 65) return 'tradeable'
  if (p >= 55) return 'marginal'
  if (p <= 45) return 'inverted — fade it'
  return 'noise'
}

/**
 * CONFLUENT / DISCORDANT (`:1461–1464`).
 *
 * Confluent means the extreme that formed FIRST is the OPPOSITE of the bias
 * side — low first + close above mid, or high first + close below mid.
 *
 * ── THE ONE DELIBERATE DEPARTURE FROM v2 ──
 * v2's discordant set is `days.filter(d => d.bias && !conf.includes(d))`: an
 * O(n) scan inside an O(n) filter, over ~2,300 sessions, re-run on every render
 * of the owner block. The `Set` below produces the identical partition — same
 * membership test, same order — at O(n). Nothing else about it changes.
 */
export function confluentDays(days: readonly SlimDay[]): { conf: SlimDay[]; disc: SlimDay[] } {
  const conf = days.filter(
    (d) => d.bias && ((d.first === 'L' && d.bias === 'H') || (d.first === 'H' && d.bias === 'L')),
  )
  const confSet = new Set<SlimDay>(conf)
  const disc = days.filter((d) => d.bias && !confSet.has(d))
  return { conf, disc }
}

/** Every population the owner cards slice out of `days`, computed once. */
export interface OwnerGroups {
  N: number
  widths: number[]
  yearsSpan: number
  fcb: SlimDay[]
  /** Bias days, and the two directional halves. */
  wb: SlimDay[]
  wbL: SlimDay[]
  wbS: SlimDay[]
  conf: SlimDay[]
  confL: SlimDay[]
  confS: SlimDay[]
  disc: SlimDay[]
  /** "the opposite side never broke", over close-confirmed breaks. */
  sbWin: number
  /** Days that carry a width bucket at all — the population of every width table. */
  wd: SlimDay[]
  narrow: SlimDay[]
  normal: SlimDay[]
  wide: SlimDay[]
  avgAtr: number
  avgAvgIb: number
  volYes: SlimDay[]
  volNo: SlimDay[]
  wickOnly: SlimDay[]
  failed: SlimDay[]
  fv: SlimDay[]
  fvB: SlimDay[]
  fvS: SlimDay[]
  rt: SlimDay[]
  noRt: SlimDay[]
  fA: SlimDay[]
  fAno: SlimDay[]
  fB: SlimDay[]
  top: SlimDay[]
  bot: SlimDay[]
  midz: SlimDay[]
  topStrong: SlimDay[]
  botStrong: SlimDay[]
  ob: SlimDay[]
  align: SlimDay[]
  oppose: SlimDay[]
  byNoon: SlimDay[]
  cont: SlimDay[]
  touchMins: number[]
  closeMins: number[]
  cbH: number[]
  cbL: number[]
  byDow: { name: string; g: SlimDay[]; gb: SlimDay[] }[]
}

/**
 * Every group the owner block builds (`IbStatsTab.tsx:1438–1523`), in one pass.
 *
 * `yearsSpan` divides by `365.25 * 864e5`; an unparseable `from`/`to` gives NaN
 * and the tile reads "NaN years of data".
 */
export function buildOwnerGroups(ds: IbDataset, days: readonly SlimDay[]): OwnerGroups {
  const N = days.length
  const widths = days.map((d) => d.width)
  const fcb = days.filter((d) => d.fcb)
  const { conf, disc } = confluentDays(days)
  const wb = days.filter((d) => d.bias)
  const wd = days.filter((d) => d.widthBucket)
  const fv = days.filter((d) => d.fvg)
  const top = days.filter((d) => d.closeZone === 'top25')
  const bot = days.filter((d) => d.closeZone === 'bot25')
  const ob = days.filter((d) => d.orbDir && d.bias)

  return {
    N,
    widths,
    yearsSpan: (new Date(ds.to).getTime() - new Date(ds.from).getTime()) / (365.25 * 864e5),
    fcb,
    wb,
    wbL: wb.filter((d) => d.bias === 'H'),
    wbS: wb.filter((d) => d.bias === 'L'),
    conf,
    confL: conf.filter((d) => d.bias === 'H'),
    confS: conf.filter((d) => d.bias === 'L'),
    disc,
    sbWin: fcb.filter((d) => (d.fcb?.side === 'H' ? !d.touchedL : !d.touchedH)).length,
    wd,
    narrow: wd.filter((d) => d.widthBucket === 'narrow'),
    normal: wd.filter((d) => d.widthBucket === 'normal'),
    wide: wd.filter((d) => d.widthBucket === 'wide'),
    avgAtr: avg(wd.map((d) => d.atr ?? 0)) ?? 0,
    avgAvgIb: avg(wd.map((d) => d.avgIB ?? 0)) ?? 0,
    volYes: fcb.filter((d) => d.fcb?.volSurge),
    volNo: fcb.filter((d) => !d.fcb?.volSurge),
    // A wick touch with no close-confirmed break — "the traps".
    wickOnly: days.filter((d) => (d.touchedH || d.touchedL) && !d.fcb),
    failed: fcb.filter((d) => d.fcb?.failed),
    fv,
    fvB: fv.filter((d) => d.fvg === 'bull'),
    fvS: fv.filter((d) => d.fvg === 'bear'),
    rt: fcb.filter((d) => d.fcb?.retest),
    // NOT the complement of `rt`: a failed-and-not-retested day is in neither.
    noRt: fcb.filter((d) => !d.fcb?.retest && !d.fcb?.failed),
    fA: fcb.filter((d) => d.fcb?.fibA.hit),
    fAno: fcb.filter((d) => !d.fcb?.fibA.hit),
    fB: fcb.filter((d) => d.fcb?.fibB.hit),
    top,
    bot,
    midz: days.filter((d) => d.closeZone === 'mid50'),
    topStrong: top.filter((d) => d.first === 'L'),
    botStrong: bot.filter((d) => d.first === 'H'),
    ob,
    align: ob.filter((d) => d.orbDir === d.bias),
    oppose: ob.filter((d) => d.orbDir !== d.bias),
    byNoon: fcb.filter((d) => (d.fcb?.breakMin ?? Infinity) < BEFORE_NOON_MIN),
    cont: days.filter((d) => d.containedAt2),
    touchMins: days.filter((d) => d.firstTouchMin != null).map((d) => d.firstTouchMin as number),
    closeMins: fcb.map((d) => d.fcb?.breakMin ?? 0),
    cbH: fcb.filter((d) => d.fcb?.side === 'H').map((d) => d.fcb?.breakMin ?? 0),
    cbL: fcb.filter((d) => d.fcb?.side === 'L').map((d) => d.fcb?.breakMin ?? 0),
    byDow: WEEKDAYS.map((name, i) => {
      const g = days.filter((d) => dowOf(d) === i + 1)
      return { name, g, gb: g.filter((d) => d.fcb) }
    }).filter((x) => x.g.length > 0),
  }
}

/** ≥1× extension rate over the break-carrying subset of a group (`:1473–1476`). */
export function extRate(a: readonly SlimDay[]): string {
  const x = a.filter((d) => d.fcb)
  return x.length ? pct(x.filter((d) => d.fcb?.hit['1']).length, x.length) : EM_DASH
}

/** "12.25 – 41.50 pts", or an em dash on an empty group (`:1477–1478`). */
export function wRange(a: readonly SlimDay[]): string {
  if (!a.length) return EM_DASH
  return `${f2(Math.min(...a.map((d) => d.width)))} – ${f2(Math.max(...a.map((d) => d.width)))} pts`
}

/**
 * CARD 2 — the 14 ranked rules (`:1525–1543`), in DECLARATION order before the
 * sort. Every label says "IB" regardless of the selected window.
 *
 * Then `.filter(n >= 8)` — the only thing preventing a 0/0 divide, and a rule
 * under it VANISHES from the table entirely, no row and no placeholder — then a
 * DESCENDING sort by hit rate. V8's sort is stable, so ties keep declaration
 * order.
 */
export function rankedRules(g: OwnerGroups): [string, number, number][] {
  const rows: [string, number, number][] = [
    ['Midpoint close bias', g.wb.length, g.wb.filter((d) => d.firstTouchSide === d.bias).length],
    [
      'Formation order + midpoint (confluent)',
      g.conf.length,
      g.conf.filter((d) => d.firstTouchSide === d.bias).length,
    ],
    ['Single break — opposite side never breaks', g.fcb.length, g.sbWin],
    [
      'Close top/bot 25% + formation order',
      g.topStrong.length + g.botStrong.length,
      g.topStrong.filter((d) => d.firstTouchSide === 'H').length +
        g.botStrong.filter((d) => d.firstTouchSide === 'L').length,
    ],
    ['ORB aligned with IB bias', g.align.length, g.align.filter((d) => d.firstTouchSide === d.bias).length],
    [
      'FVG direction = break direction',
      g.fv.length,
      g.fv.filter((d) => d.firstTouchSide === (d.fvg === 'bull' ? 'H' : 'L')).length,
    ],
    ['Failed break → opposite extreme', g.failed.length, g.failed.filter((d) => d.fcb?.fadeOpp).length],
    ['Retest → continuation', g.rt.length, g.rt.filter((d) => d.fcb?.retestCont).length],
    [
      '0.25 fib pullback (IB range) → continuation',
      g.fA.length,
      g.fA.filter((d) => d.fcb?.fibA.cont).length,
    ],
    [
      '0.25 fib pullback (impulse) → continuation',
      g.fB.length,
      g.fB.filter((d) => d.fcb?.fibB.cont).length,
    ],
    ['Break + volume surge → ≥1× ext', g.volYes.length, g.volYes.filter((d) => d.fcb?.hit['1']).length],
    ['Narrow IB → single break', g.narrow.length, g.narrow.filter((d) => d.singleBreak).length],
    ['Wide IB → both sides break (rotation)', g.wide.length, g.wide.filter((d) => d.bothBroke).length],
    ['Contained at 2pm → stays contained', g.cont.length, g.cont.filter((d) => !d.containedBrokeLate).length],
  ]
  return rows
    .filter(([, n]) => n >= SAMPLE_FLOORS.ruleRanking)
    .sort((a, b) => b[2] / b[1] - a[2] / a[1])
}

/**
 * CARD 4's cumulative bucket ladder (`:1452–1455`).
 *
 * Built from the window-relative first three entries plus five fixed clock
 * times, then filtered to `m >= REND` and DE-DUPLICATED BY MINUTE, keeping the
 * FIRST occurrence. On IB 60m that means `REND+30 = 660` wins and the literal
 * "by 11:00" entry is the one dropped — the surviving label happens to be
 * "by 11:00" as well, so the table reads correctly by coincidence.
 */
export function timeBuckets(rEnd: number): [number, string][] {
  const all: [number, string][] = [
    [rEnd, `by ${clock(rEnd)} (first bar out)`],
    [rEnd + 15, `by ${clock(rEnd + 15)}`],
    [rEnd + 30, `by ${clock(rEnd + 30)}`],
    [660, 'by 11:00'],
    [720, 'by 12:00 (noon)'],
    [780, 'by 13:00'],
    [840, 'by 14:00'],
    [900, 'by 15:00'],
  ]
  return all.filter(([m], i, a) => m >= rEnd && a.findIndex(([x]) => x === m) === i)
}

/**
 * Every card title, subtitle, column header, footnote and detail string in the
 * owner block, in render order. Kept as data so step 3 cannot paraphrase one.
 *
 * `accent` is v2's per-card title hue. It is recorded because it is otherwise
 * unrecoverable, NOT because v3 should keep six title colours — see the
 * "REMOVED IN v2" note at the top of the file.
 */
export const OWNER_CARDS = {
  disclosure: {
    show: (n: number): string => `Show historical stats (${n} sessions) ▼ (owner)`,
    hide: 'Hide historical stats ▲ (owner)',
  },

  header: {
    accent: 'blue',
    title: (win: IbWindow, ds: IbDataset): string =>
      `${winLabel(win)} Stats — ${ds.symbol} ${ds.barMinutes}m RTH`,
    subtitle: (win: IbWindow): string => `${winRange(win)} ET · last updated ${LAST_UPDATED}`,
    tiles: {
      sessions: 'Sessions',
      sessionsSub: (years: number): string => `${years.toFixed(1)} years of data`,
      dateRange: 'Date range',
      dateRangeSub: (bar: number): string => `${bar}m bars, RTH`,
      avgWidth: (win: IbWindow): string => `Avg ${winLabel(win)} width`,
      medWidth: (win: IbWindow): string => `Median ${winLabel(win)} width`,
      shareOfDay: 'Range as % of day range',
    },
    body: (win: IbWindow): string =>
      `${winLabel(win)} = ${winRange(win)} ET high/low. A break means a bar close outside the range — wick-only touches are tracked separately as the trap set. Extensions, MFE and MAE are quoted in multiples of range width, measured from the broken level. Every rule below is identical across windows, so the tabs above are directly comparable: the shorter the window, the earlier the entry and the higher the both-sides-broke tax.`,
    /** v2 bolds exactly these two words inside the body copy. */
    bodyBold: ['break', 'close'],
  },

  ranking: {
    accent: 'green',
    /** ★ is U+2605. */
    title: '★ Rule Ranking — highest hit rate first',
    subtitle: 'Rules with ≥8 sample days only',
    head: ['Rule', 'Sample (days)', 'Hit', 'Hit rate', 'Verdict'],
    footNote:
      'Sample size is the first thing to check — a 90% hit rate on 9 days is nothing. A rule at 50±5% is a coin flip.',
  },

  baseline: {
    accent: 'cyan',
    title: '0 · Baseline — IB break behavior',
    subtitle: 'The benchmark every rule must beat',
    head: ['Outcome', 'Days', 'Hit', 'Rate', 'Note'],
    rows: {
      touchedH: 'IB high broken (any wick)',
      touchedL: 'IB low broken (any wick)',
      single: 'SINGLE break only (one side)',
      singleDetail: "the 'single break' edge",
      both: 'BOTH sides broken (rotation)',
      neither: 'NEITHER side broken (contained)',
      closeBreak: 'Break confirmed by a bar CLOSE',
    },
  },

  breakTime: {
    accent: 'purple',
    title: '0b · Time of IB Break',
    subtitle: 'When the first break actually happens',
    tiles: {
      avgTouch: 'Avg · first TOUCH',
      avgClose: 'Avg · CLOSE break',
      medClose: 'Median · CLOSE break',
      avgHigh: 'Avg · HIGH breaks',
      avgLow: 'Avg · LOW breaks',
      extremes: 'Earliest / Latest',
      /** Subtracts 570 UNCONDITIONALLY, so on an ORB tab it measures from 09:30. */
      minsAfterOpen: (mins: number | null): string => `${f2((mins ?? 0) - RTH_OPEN)} min after IB open`,
      nDays: (n: number): string => `n = ${n} days`,
      n: (n: number): string => `n = ${n}`,
    },
    head: ['Break has occurred…', 'Break days', 'Count', 'Cumulative %', 'Note'],
    rowDetail: 'cumulative',
    footNote:
      "The steepest part of this curve is your attention window — that's when to be at the screen.",
  },

  dow: {
    accent: 'blue',
    title: '0c · Day of the Week',
    subtitle:
      'Same rules, sliced by weekday — where the trend days and the chop days actually live',
    /** Header 3 says "IB" on every window tab. NO SORT — always Monday→Friday. */
    head: [
      'Day',
      'Sessions',
      'Avg IB width',
      'Single break',
      'Both sides (rotation)',
      'Never broke',
      'Break ≥1× ext',
      'Fail rate',
      'Avg break time',
      'High breaks first',
    ],
    totalsLabel: 'ALL DAYS',
    footNote:
      'Read each weekday against the ALL DAYS row, not against 50%. A day only matters if it deviates from the sample’s own baseline by more than a few points — with ~450 sessions per weekday, a 3–4 point gap is still inside the noise band.',
  },

  rule1: {
    accent: 'cyan',
    title: '1 · Midpoint Close Bias',
    subtitle: 'IB closes above mid → high breaks first. Below mid → low breaks first.',
    head: ['Signal', 'Days', 'Correct', 'Hit rate', 'Detail'],
    rows: {
      all: 'All midpoint-bias days',
      long: 'Bias LONG (close > mid)',
      longDetail: 'predicted high breaks first',
      short: 'Bias SHORT (close < mid)',
      shortDetail: 'predicted low breaks first',
      ever: '…and that side EVER breaks',
      everDetail: 'looser test — breaks at any point',
    },
  },

  rule2: {
    accent: 'green',
    title: '2 · Formation Order + Midpoint',
    subtitle: 'Low forms first + close above mid → long. High first + close below mid → short.',
    head: ['Setup', 'Days', 'Correct', 'Hit rate', 'Detail'],
    rows: {
      confluent: 'CONFLUENT (order agrees with bias)',
      confluentDetail: 'the A+ filter',
      long: 'Long (low first, close > mid)',
      short: 'Short (high first, close < mid)',
      discordant: 'DISCORDANT (order fights bias)',
      discordantDetail: 'skip these',
    },
    footNote:
      'Compare CONFLUENT against the raw midpoint bias in Rule 1 — the delta is the entire value of the formation-order filter.',
  },

  rule3: {
    accent: 'orange',
    title: '3 · Single Break Continuation',
    subtitle: 'The claimed 70–85% edge, tested on close-confirmed breaks',
    head: ['Test', 'Days', 'Hit', 'Rate', 'Detail'],
    rows: {
      oppositeNever: 'Opposite IB side NEVER breaks',
      oppositeNeverDetail: 'true single-break day after entry',
      ext05: 'Break extends ≥ 0.5× IB width',
      ext10: 'Break extends ≥ 1.0× IB width',
      /** Reads `noMidReturn`, an EXPORT-ONLY field nothing in the repo computes. */
      noMidReturn: 'Never trades back to the IB midpoint',
      noMidReturnDetail: 'strictest version',
    },
  },

  rule4: {
    accent: 'red',
    title: '4 · IB Width → Day Type',
    subtitle: 'Narrow → trend/break. Wide → rotation, fade the breaks.',
    tiles: {
      narrowK: 'NARROW = width <',
      /** TWO spaces either side of "or", in v2. */
      narrowV: '0.5× ATR14  or  0.75× avgIB20',
      wideK: 'WIDE = width >',
      wideV: '1.5× ATR14  or  1.25× avgIB20',
      normalK: 'NORMAL',
      normalV: 'everything between',
      normalSub: 'the default state',
      averagesK: 'Sample averages',
      averagesSub: 'RTH daily range / 20d mean IB',
      under: (pts: number): string => `≈ under ${f2(pts)} pts at current vol`,
      over: (pts: number): string => `≈ over ${f2(pts)} pts at current vol`,
    },
    head: ['Bucket', 'Days', 'Single-break', 'Rate', 'Both sides broke / ≥1× ext'],
    rangeHead: ['Bucket', 'Actual IB widths in sample', 'Mean', 'Days', 'Share of sessions'],
    rows: {
      narrow: 'NARROW IB',
      normal: 'NORMAL IB',
      /** The WIDE row's "hit" column is the BOTH-SIDES rate — a different metric. */
      wide: 'WIDE IB',
      wideDetail: (ext: string): string => `hit col = BOTH-sides rate · ≥1× ext: ${ext}`,
      detail: (both: string, ext: string): string => `both: ${both} · ≥1× ext: ${ext}`,
    },
    footNote:
      'Use the ×ATR / ×avgIB rule live — the point ranges are just what those adaptive thresholds worked out to across this sample, so they overlap as vol regimes shift.',
  },

  rule5: {
    accent: 'green',
    title: '5 · Breakout Entry — close beyond IB + volume',
    subtitle: 'Volume filter = break-bar volume > average IB bar volume',
    head: ['Entry filter', 'Days', '≥1× IB ext', 'Rate', 'Avg MFE / MAE (× IB width)'],
    rows: {
      surge: 'Close break + VOLUME surge',
      noSurge: 'Close break, NO volume surge',
      wickOnly: 'WICK-only touch (no close outside)',
      wickOnlyDetail: 'the traps — no entry taken',
      mfeMae: (mfe: number | null, mae: number | null): string => `MFE ${f2(mfe)}× / MAE ${f2(mae)}×`,
    },
    footNote:
      "MAE is your stop-distance requirement — it's the heat the average winner still made you sit through.",
  },

  rule6: {
    accent: 'red',
    title: '6 · Failed Breakout Fade',
    subtitle: 'Break closes outside, then closes back inside within 30 min',
    head: ['Outcome', 'Days', 'Hit', 'Rate', 'Detail'],
    rows: {
      fails: 'Break FAILS (closes back inside ≤30m)',
      failsDetail: 'base rate of the trap',
      mid: 'then reaches the IB MIDPOINT',
      midDetail: 'target 1',
      opp: 'then reaches the OPPOSITE IB extreme',
      oppDetail: 'target 2 — the money target',
    },
    /** v2 renders this through dangerouslySetInnerHTML with <b> around the number. */
    footNote: (peakPts: number | null): string =>
      `Avg excursion before the fail: ${f2(peakPts)} pts — that is roughly the stop a breakout entry has to survive.`,
  },

  rule7: {
    accent: 'purple',
    title: '7 · 15m FVG inside the IB',
    subtitle: '15m fair-value gap, rebuilt from the raw bars',
    head: ['FVG', 'Days', 'Reaches IB extreme in FVG dir', 'Rate', 'Reaches midpoint'],
    rows: {
      bull: 'BULLISH FVG in IB',
      bear: 'BEARISH FVG in IB',
      dir: 'FVG direction = first-touch side',
      dirDetail: 'directional predictive power',
      control: 'NO FVG in IB (control) → single break',
      controlDetail: 'control group',
      /** Reads `fvgHitMid`, the second EXPORT-ONLY field. */
      midDetail: (p: string): string => `mid: ${p}`,
    },
  },

  rule8: {
    accent: 'cyan',
    title: '8 · Retest Continuation',
    subtitle: 'Returns to within 2 ticks of the broken level, close holds outside',
    head: ['Path', 'Days', 'Continues to new extreme', 'Rate', 'Avg MFE (× IB width)'],
    rows: {
      retest: 'Break → clean RETEST → continue',
      noRetest: 'Break → NO retest (runs away)',
      mfe: (v: number | null): string => `${f2(v)}×`,
      noRetestDetail: (v: number | null): string => `${f2(v)}× (hit = ≥1× ext)`,
    },
    footNote:
      "If retest MFE ≥ no-retest MFE, waiting costs nothing and improves the entry. If it's materially lower, the best days never retest — take the break.",
  },

  fib: {
    accent: 'green',
    title: 'B · 0.25 Fib Pullback → Continuation',
    /** v2 writes the quotes as &quot; entities. */
    subtitle: 'Two readings of "the 0.25 level" — they are very different trades',
    head: ['Test', 'Days', 'Hit', 'Rate', 'Detail'],
    sectionA:
      'Variant A — 0.25 of the IB RANGE, measured back into the IB (high break → IBH − 0.25×width). A deep pullback that re-enters the IB.',
    sectionB:
      'Variant B — 0.25 retrace of the post-break IMPULSE (break level → running extreme). A shallow pullback that stays outside the IB.',
    rows: {
      aReach: 'Pullback REACHES the 0.25 level',
      aReachDetail: 'how often you even get filled',
      cont: 'then CONTINUES to a new extreme',
      contDetail: 'the actual edge',
      aFail: 'instead runs through the IB MIDPOINT',
      aFailDetail: 'trade dies',
      aNone: 'NO pullback — price never comes back',
      aNoneDetail: (mfe: number | null): string => `these run: avg MFE ${f2(mfe)}× IB`,
      bReach: 'Pullback REACHES the 0.25 impulse retrace',
      bReachDetail: 'requires impulse > 0.25× IB first',
    },
    footNote: (mfe: number | null): string =>
      `Variant A avg MFE measured from the 0.25 entry: ${f2(mfe)}× IB width. Watch the "no pullback" row — if the runaway days carry the fattest MFE, waiting for 0.25 filters you out of the best sessions.`,
  },

  rule9: {
    accent: 'orange',
    title: '9 · Extension Targets',
    subtitle: 'Scale-out probabilities, measured from the broken level',
    head: ['Target', 'Breaks', 'Reached', 'Hit rate', 'Sizing'],
    rowLabel: (t: number): string => `${t}× IB width from break`,
    rowDetail: (avgW: number | null, t: number): string =>
      `avg IB ${f2(avgW)} pts → target ≈ ${f2(t * (avgW ?? 0))} pts`,
    footNote: (rExt: number | null, rAdv: number | null): string =>
      `Avg MFE on all close-breaks: ${f2(rExt)}× IB width · avg MAE (heat taken): ${f2(rAdv)}× IB width.`,
  },

  rule10: {
    accent: 'green',
    title: '10 · Close Location in IB Range',
    subtitle: 'Top 25% + low first → strong long. Bottom 25% + high first → strong short.',
    head: ['Zone', 'Days', 'Breaks as predicted', 'Rate', 'Detail'],
    rows: {
      top: 'TOP 25% close',
      topStrong: '+ LOW formed first (STRONG LONG)',
      bot: 'BOTTOM 25% close',
      botStrong: '+ HIGH formed first (STRONG SHORT)',
      /** Counts `null === null` as a hit — a session with neither scores correct. */
      mid: 'MIDDLE 50% close (no edge expected)',
      midDetail: 'bias hit-rate — expect a coin flip',
      plainZone: 'plain zone',
      singleBreak: (p: string): string => `single-break: ${p}`,
    },
  },

  rule11: {
    accent: 'purple',
    title: '11 · Open Type + IB Width',
    subtitle: 'OAR = open outside the prior RTH range · HIR/LIR = open inside it',
    head: ['Open type', 'Days', 'Hit', 'Rate', "What 'hit' means"],
    rows: {
      all: (ot: OpenType): string => `${ot} — all`,
      allDetail: 'single-break rate',
      narrow: (ot: OpenType): string => `${ot} + NARROW IB`,
      narrowDetail: 'breakout thesis',
      wide: (ot: OpenType): string => `${ot} + WIDE IB`,
      wideDetail: 'both-sides broke = rotation thesis',
    },
    footNote:
      'OAR-H / OAR-L = opened above / below the prior RTH range. HIR / LIR = opened inside the prior range, in the upper / lower half.',
  },

  rule12: {
    accent: 'cyan',
    title: '12 · ORB + IB Alignment',
    subtitle: '09:30–09:45 opening range breaks the same way as the IB midpoint bias',
    head: ['Setup', 'Days', 'Bias side breaks first', 'Rate', 'Single-break rate'],
    rows: {
      aligned: 'ALIGNED (ORB dir = IB bias)',
      conflicted: 'CONFLICTED (ORB vs IB bias)',
    },
    footNote: 'Aligned should beat conflicted on BOTH columns for this filter to earn its keep.',
  },

  rule13: {
    accent: 'orange',
    title: '13 · Time Filter — when the break happens',
    subtitle: 'Hit = extension ≥ 1× IB width',
    head: ['Break window', 'Breaks', '≥1× ext', 'Rate', 'Detail'],
    rowDetail: (mfe: number | null, failRate: string): string =>
      `avg MFE ${f2(mfe)}× · fail rate ${failRate}`,
    beforeNoon: 'ALL breaks before noon',
    beforeNoonDetail: 'the killzone cut',
    footNote:
      "Late breaks have less session left — expect decaying extension rates. If they don't decay, the break is time-agnostic.",
  },

  rule14: {
    accent: 'red',
    title: '14 · Contained Day (rare)',
    subtitle: 'Price still entirely inside the IB at 14:00 ET',
    head: ['Outcome', 'Days', 'Hit', 'Rate', 'Detail'],
    rows: {
      contained: 'Contained at 14:00',
      containedDetail: 'base rate of the setup',
      stays: 'STAYS inside through the close (fade works)',
      staysDetail: 'fade the extremes',
      breaks: 'BREAKS out late (fade gets run over)',
      breaksDetail: 'the tail risk',
    },
  },
} as const

/** The three bucket-label colours in card 4's width-range table (`:1725`). */
export const WIDTH_BUCKET_COLORS: Record<'NARROW' | 'NORMAL' | 'WIDE', string> = {
  NARROW: V2.up,
  NORMAL: V2.orange,
  WIDE: V2.red,
}

/**
 * CARD 4's threshold captions (`:1709–1710`).
 *
 * BUG (v2): the NARROW caption quotes `Math.min(0.5×ATR, 0.75×avgIB)` where the
 * OR in the classifier makes the effective boundary the LARGER of the two — a
 * width qualifies as narrow if it is under EITHER, so the caption understates
 * the ceiling. The WIDE caption's `Math.min` is correct for the same reason.
 * Ported as written; Q7 asks whether the conservative reading was intended.
 */
export function narrowCaptionPts(avgAtr: number, avgAvgIb: number): number {
  return Math.min(0.5 * avgAtr, 0.75 * avgAvgIb)
}
export function wideCaptionPts(avgAtr: number, avgAvgIb: number): number {
  return Math.min(1.5 * avgAtr, 1.25 * avgAvgIb)
}

/**
 * CARD 10's third row (`:1744`).
 *
 * BUG (v2): `hits` is the LITERAL 0, so the Rate cell always reads "0.0%" in the
 * down colour — a measured-looking number that was never measured. Ported as
 * written so step 3 can see it and decide between a real metric ("of wick-only
 * days, how many later got a close break") and an em dash (Q6).
 */
export const WICK_ONLY_HITS = 0

// ─────────────────────────────────────────────────────────────────────────────
// THE TAB FRAME — control strip, loading and error copy, the owner gate.
// Spec rows G4, G5, G12, G13, G15–G25, G162.
// ─────────────────────────────────────────────────────────────────────────────

export const TAB_TEXT = {
  /** Each window button's tooltip is its range plus " ET" (`:1421`). */
  windowTitle: (win: IbWindowDef): string => `${win.range} ET`,
  /** The caption at the end of the strip (`:1425`), 70% opacity in v2. */
  rangeCaption: (win: IbWindow): string => `${winRange(win)} ET`,
  loadingTitle: (win: IbWindow): string => `${winLabel(win)} Stats`,
  loadingBody: (sym: IbSymbol, win: IbWindow): string =>
    `Loading ${sym} ${winLabel(win)} dataset…`,
  errorTitle: (win: IbWindow): string => `${winLabel(win)} Stats — dataset not found`,
} as const

/**
 * THE OWNER GATE (`IbStatsTab.tsx:1374–1380`).
 *
 * The TAB itself is public — `scannerNav.ts` gives `ibstats` no `ownerOnly` flag,
 * so it is not in `OWNER_ONLY_TABS`. Exactly two blocks inside it are gated:
 * the "Show historical stats" disclosure with its sixteen cards, and the daily
 * results scoreboard. A non-owner sees three cards: Live Read, IB Read,
 * Probability Engine.
 *
 * v2's test is `isOwnerClaim || (env owner id ? userId === env owner id : false)`
 * with NO `loaded` guard, so the owner briefly sees the public view while auth
 * resolves and the button then appears. It also reads `useAuth().userId` where
 * `useIsOwner.ts:29` reads `useAuth().user?.id` — two different fields for one
 * test, and if the former does not exist the env-var fallback has never fired
 * (open question Q1). v3 resolves ownership once, in one place; this constant
 * records WHAT is gated, not how the check is spelled.
 */
export const OWNER_GATED_BLOCKS = ['historical-stats', 'daily-results'] as const

/**
 * The three cards `LiveToday` returns, in render order (`IbStatsTab.tsx:426–443`).
 * v2's own comment there says "Only three cards" — `RuleBoard` and
 * `PlaybookLegacy` are in the same file and in none of them.
 */
export const LIVE_CARD_ORDER = ['live-read', 'ib-read', 'probability-engine'] as const

/**
 * WHERE THE CANDLES COME FROM, and what v3 must do differently.
 *
 * v2 mounts BOTH `useEsCandles(sym === "ES", 2)` and `useNqCandles(sym === "NQ", 2)`
 * on every render and enables the matching one; switching symbol tears one down
 * and connects the other, and there is a gap in between where neither has bars
 * and the "Waiting for today's bars…" card shows.
 *
 * Three facts that must survive the port (spec rows G44–G48):
 *   • `historyDays = 2` — the second session is what supplies `pdh`/`pdl` for
 *     rule 11 when the live tape carries no prior-dated bars.
 *   • `withAverages` DEFAULTS TRUE on the ES hook, which runs two full
 *     `buildSlotAverages` passes over the history on EVERY republish for
 *     `avg5`/`avg14` fields this tab never reads. Pass false.
 *   • Live frames are coalesced on a 250 ms trailing timer — a 4 Hz publish
 *     ceiling — so anything downstream of `computeLiveSession` re-runs at most
 *     four times a second, and must not do more work than it has to.
 *
 * v3 non-negotiable 2: a page does not open a socket. The candles arrive through
 * `useFrame` / `useField` / `watchFrame` from `@/data/hooks`, in step 3, and are
 * handed to `computeLiveSession` as plain `IbCandle[]`.
 */
export const LIVE_FEED_HISTORY_DAYS = 2

/**
 * ── DATASET SEMANTICS (the offline exporter) ────────────────────────────────
 * Spec rows G251–G278. NOT ported as code — see the header's "lib/ibStats.ts:
 * WHAT WAS AND WAS NOT PORTED". Recorded here because every percentage this tab
 * renders is derived from fields written under these rules, so a v3 that ever
 * regenerates a dataset must reproduce them exactly:
 *
 *   INPUT      `YYYYMMDD HHMMSS,open,high,low,close,volume`, RTH 5m bars.
 *              Rows with <6 fields, an unparseable first field (this is how the
 *              header row is dropped) or a non-finite o/h/l/c are skipped;
 *              volume falls back to 0.
 *   DAY GATE   a session needs >= 10 IB bars AND >= 10 post bars, and a width
 *              > 0, or it is DROPPED — invisible downstream, with no gap marker.
 *   IB         `min >= 570 && min < 630`; ibVol is the MEAN bar volume, not the
 *              total.
 *   first      has the third tie-break branch (firstFormedDataset above).
 *   orb        `ibBars.slice(0, 3)` — the first three bars BY POSITION, i.e.
 *              09:30–09:45 at 5m and 09:30–09:33 at 1m. The live path and the
 *              EOD grader both use `min < 585`, which is bar-size independent.
 *   fvg        15m candles built by CHUNKING three bars at a time (`i += 3`),
 *              not by minute window; the LAST qualifying gap wins (no break).
 *   orbDir     scans `ibBars.slice(3)` and DOES break on the first match.
 *   pdh/pdl    taken from `days[i-1]` — the previous SURVIVING session, which
 *              after the day-gate drops is not necessarily the previous
 *              calendar session.
 *   atr        a plain MEAN of RTH high−low over the trailing 14 (min 5), with
 *              no gap component and no Wilder smoothing. "ATR14" overstates it.
 *   firstTouch the first post bar that wicks outside, HIGH CHECKED FIRST inside
 *              a bar — so an outside bar always records "H". `lib/ibDaily.ts:114`
 *              instead breaks that tie by magnitude, so the dataset and the EOD
 *              recorder disagree on outside-bar days.
 *   MFE/MAE    over `post.slice(breakIdx + 1)` — the BREAK BAR ITSELF IS
 *              EXCLUDED — as wick excursions in points, then divided by width.
 *   failed     within the first SIX BARS of that remainder (not 30 clock
 *              minutes), freezing `peakBeforeFail` in POINTS at that moment.
 *   hit        `mfe >= t * width`, inclusive, for t in 0.5/1/1.5/2.
 *   fibA       0.25 of the IB RANGE back inside the IB; `cont` and `fail` are
 *              NOT mutually exclusive, so card 14's rows 2 and 3 can sum past
 *              100%.
 *   fibB       0.25 of the post-break IMPULSE; carries ONLY `hit` and `cont` —
 *              `fail`, `mfe` and `lvl` are hardcoded null, which is why variant
 *              B has two rows to variant A's four.
 *   contained  WICK-based (containedAtTwoDataset above).
 *   retest     the strict version (retestDataset above).
 */
export const DATASET_MIN_BARS = SAMPLE_FLOORS.datasetMinBars

// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER CARDS' ROWS, CARD BY CARD.
//
// Spec rows G166–G201. Every row's `n` and `hits` are written here rather than
// left to step 3, because a row's DENOMINATOR is the part a rewrite gets wrong:
// several of these cards mix populations deliberately (card 9's WIDE row counts
// a different outcome in the same column; card 17 slices `wd`, not `days`;
// card 13's two paths are not complementary), and every one of those choices is
// invisible from the screen.
// ─────────────────────────────────────────────────────────────────────────────

/** CARD 1 — the five header tiles (`:1581–1587`). All white, no colour ladder. */
export function headerTiles(ds: IbDataset, days: readonly SlimDay[], g: OwnerGroups, win: IbWindow): StatTile[] {
  return [
    {
      k: OWNER_CARDS.header.tiles.sessions,
      v: String(g.N),
      sub: OWNER_CARDS.header.tiles.sessionsSub(g.yearsSpan),
    },
    {
      k: OWNER_CARDS.header.tiles.dateRange,
      v: `${ds.from} → ${ds.to}`,
      sub: OWNER_CARDS.header.tiles.dateRangeSub(ds.barMinutes),
    },
    { k: OWNER_CARDS.header.tiles.avgWidth(win), v: `${f2(avg(g.widths))} pts` },
    { k: OWNER_CARDS.header.tiles.medWidth(win), v: `${f2(med(g.widths))} pts` },
    {
      k: OWNER_CARDS.header.tiles.shareOfDay,
      v: `${f2((avg(days.map((d) => d.width / d.dayRange)) ?? 0) * 100)}%`,
    },
  ]
}

/** CARD 2 — the ranking rows. `detail` is the verdict ladder. */
export function rankingRows(g: OwnerGroups): StatRow[] {
  return rankedRules(g).map(([label, n, hits]) => ({
    label,
    n,
    hits,
    detail: verdict(n, (100 * hits) / n),
  }))
}

/** CARD 3 — the baseline. Every row's denominator is the FULL session count. */
export function baselineRows(days: readonly SlimDay[], g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.baseline.rows
  return [
    { label: t.touchedH, n: g.N, hits: days.filter((d) => d.touchedH).length },
    { label: t.touchedL, n: g.N, hits: days.filter((d) => d.touchedL).length },
    {
      label: t.single,
      n: g.N,
      hits: days.filter((d) => d.singleBreak).length,
      detail: t.singleDetail,
    },
    { label: t.both, n: g.N, hits: days.filter((d) => d.bothBroke).length },
    { label: t.neither, n: g.N, hits: days.filter((d) => d.neitherBroke).length },
    { label: t.closeBreak, n: g.N, hits: g.fcb.length },
  ]
}

/** CARD 4 — the six timing tiles (`:1615–1622`). */
export function breakTimeTiles(g: OwnerGroups): StatTile[] {
  const t = OWNER_CARDS.breakTime.tiles
  const first = avg(g.touchMins)
  const close = avg(g.closeMins)
  return [
    { k: t.avgTouch, v: clock(first), sub: t.minsAfterOpen(first) },
    { k: t.avgClose, v: clock(close), sub: t.minsAfterOpen(close) },
    { k: t.medClose, v: clock(med(g.closeMins)), sub: t.nDays(g.closeMins.length) },
    { k: t.avgHigh, v: clock(avg(g.cbH)), sub: t.n(g.cbH.length) },
    { k: t.avgLow, v: clock(avg(g.cbL)), sub: t.n(g.cbL.length) },
    {
      k: t.extremes,
      v: g.closeMins.length
        ? `${clock(Math.min(...g.closeMins))} – ${clock(Math.max(...g.closeMins))}`
        : EM_DASH,
    },
  ]
}

/** CARD 4 — the cumulative table. Every row's denominator is the break count. */
export function breakTimeRows(g: OwnerGroups, rEnd: number): StatRow[] {
  return timeBuckets(rEnd).map(([m, label]) => ({
    label,
    n: g.closeMins.length,
    hits: g.closeMins.filter((x) => x <= m).length,
    detail: OWNER_CARDS.breakTime.rowDetail,
  }))
}

/** One weekday row of card 5 (`:1640–1657`). */
export interface DowRow {
  name: string
  sessions: number
  avgWidth: string
  /** Columns 4, 5 and 7 are the ONLY coloured ones — see DOW_COLORED_COLUMNS. */
  single: number | null
  both: number | null
  never: string
  ext: number | null
  failRate: string
  avgBreakTime: string
  highFirst: string
}

/** The three columns that take `rateColor` + weight 800. Zero-based. */
export const DOW_COLORED_COLUMNS = [3, 4, 6] as const

/**
 * Card 5's weekday rows. NOTE the two populations: `g` is all that weekday's
 * sessions, `gb` only the ones carrying a close-confirmed break, and the columns
 * switch between them without saying so.
 */
export function dowRows(g: OwnerGroups): DowRow[] {
  return g.byDow.map(({ name, g: gg, gb }) => ({
    name,
    sessions: gg.length,
    avgWidth: f2(avg(gg.map((d) => d.width))),
    single: rateNum(gg.filter((d) => d.singleBreak).length, gg.length),
    both: rateNum(gg.filter((d) => d.bothBroke).length, gg.length),
    never: pct(gg.filter((d) => d.neitherBroke).length, gg.length),
    ext: rateNum(gb.filter((d) => d.fcb?.hit['1']).length, gb.length),
    failRate: pct(gb.filter((d) => d.fcb?.failed).length, gb.length),
    avgBreakTime: clock(avg(gb.map((d) => d.fcb?.breakMin ?? 0))),
    highFirst: pct(
      gg.filter((d) => d.firstTouchSide === 'H').length,
      gg.filter((d) => d.firstTouchSide).length,
    ),
  }))
}

/**
 * Card 5's ALL DAYS row (`:1659–1670`).
 *
 * Two things about it: every cell is bold and NONE of them take the rate colour
 * — the totals row deliberately drops the ladder so it reads as a baseline, not
 * a score — and its population is `days`, which INCLUDES any weekend session the
 * weekday rows above dropped. The two halves of the table are therefore not over
 * the same set.
 */
export function dowTotalsRow(days: readonly SlimDay[], g: OwnerGroups): DowRow {
  return {
    name: OWNER_CARDS.dow.totalsLabel,
    sessions: g.N,
    avgWidth: f2(avg(g.widths)),
    single: null,
    both: null,
    never: pct(days.filter((d) => d.neitherBroke).length, g.N),
    ext: null,
    failRate: pct(g.fcb.filter((d) => d.fcb?.failed).length, g.fcb.length),
    avgBreakTime: clock(avg(g.closeMins)),
    highFirst: pct(
      days.filter((d) => d.firstTouchSide === 'H').length,
      days.filter((d) => d.firstTouchSide).length,
    ),
  }
}

/** The totals row's three "rate" cells, which are STRINGS in v2, not numbers. */
export function dowTotalsRates(days: readonly SlimDay[], g: OwnerGroups): {
  single: string
  both: string
  ext: string
} {
  return {
    single: pct(days.filter((d) => d.singleBreak).length, g.N),
    both: pct(days.filter((d) => d.bothBroke).length, g.N),
    ext: pct(g.fcb.filter((d) => d.fcb?.hit['1']).length, g.fcb.length),
  }
}

/** CARD 6 — rule 1, midpoint bias. */
export function rule1Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule1.rows
  return [
    { label: t.all, n: g.wb.length, hits: g.wb.filter((d) => d.firstTouchSide === d.bias).length },
    {
      label: t.long,
      indent: true,
      n: g.wbL.length,
      hits: g.wbL.filter((d) => d.firstTouchSide === 'H').length,
      detail: t.longDetail,
    },
    {
      label: t.short,
      indent: true,
      n: g.wbS.length,
      hits: g.wbS.filter((d) => d.firstTouchSide === 'L').length,
      detail: t.shortDetail,
    },
    {
      label: t.ever,
      n: g.wb.length,
      hits: g.wb.filter((d) => (d.bias === 'H' ? d.touchedH : d.touchedL)).length,
      detail: t.everDetail,
    },
  ]
}

/** CARD 7 — rule 2, formation order. */
export function rule2Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule2.rows
  return [
    {
      label: t.confluent,
      n: g.conf.length,
      hits: g.conf.filter((d) => d.firstTouchSide === d.bias).length,
      detail: t.confluentDetail,
    },
    {
      label: t.long,
      indent: true,
      n: g.confL.length,
      hits: g.confL.filter((d) => d.firstTouchSide === 'H').length,
    },
    {
      label: t.short,
      indent: true,
      n: g.confS.length,
      hits: g.confS.filter((d) => d.firstTouchSide === 'L').length,
    },
    {
      label: t.discordant,
      n: g.disc.length,
      hits: g.disc.filter((d) => d.firstTouchSide === d.bias).length,
      detail: t.discordantDetail,
    },
  ]
}

/** CARD 8 — rule 3. Every row's denominator is the close-confirmed break count. */
export function rule3Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule3.rows
  return [
    { label: t.oppositeNever, n: g.fcb.length, hits: g.sbWin, detail: t.oppositeNeverDetail },
    { label: t.ext05, n: g.fcb.length, hits: g.fcb.filter((d) => d.fcb?.hit['0.5']).length },
    { label: t.ext10, n: g.fcb.length, hits: g.fcb.filter((d) => d.fcb?.hit['1']).length },
    {
      // Reads `noMidReturn`, which nothing in the repo computes: an export
      // missing the field makes this row read 0.0% in the down colour (Q3).
      label: t.noMidReturn,
      n: g.fcb.length,
      hits: g.fcb.filter((d) => d.noMidReturn).length,
      detail: t.noMidReturnDetail,
    },
  ]
}

/** CARD 9 — the four threshold tiles. See narrowCaptionPts for the min/max note. */
export function widthTiles(g: OwnerGroups): StatTile[] {
  const t = OWNER_CARDS.rule4.tiles
  return [
    { k: t.narrowK, v: t.narrowV, sub: t.under(narrowCaptionPts(g.avgAtr, g.avgAvgIb)) },
    { k: t.wideK, v: t.wideV, sub: t.over(wideCaptionPts(g.avgAtr, g.avgAvgIb)) },
    { k: t.normalK, v: t.normalV, sub: t.normalSub },
    {
      k: t.averagesK,
      v: `ATR14 ${f2(g.avgAtr)} · avgIB20 ${f2(g.avgAvgIb)}`,
      sub: t.averagesSub,
    },
  ]
}

/**
 * CARD 9 — the bucket outcome table.
 *
 * THE WIDE ROW COUNTS A DIFFERENT METRIC IN THE SAME COLUMN: narrow and normal
 * report the SINGLE-BREAK rate, wide reports the BOTH-SIDES rate. Its detail
 * string is the only thing that says so, and the "Rate" column header covers
 * both. Transcribed as written.
 */
export function widthBucketRows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule4.rows
  return [
    {
      label: t.narrow,
      n: g.narrow.length,
      hits: g.narrow.filter((d) => d.singleBreak).length,
      detail: t.detail(pct(g.narrow.filter((d) => d.bothBroke).length, g.narrow.length), extRate(g.narrow)),
    },
    {
      label: t.normal,
      n: g.normal.length,
      hits: g.normal.filter((d) => d.singleBreak).length,
      detail: t.detail(pct(g.normal.filter((d) => d.bothBroke).length, g.normal.length), extRate(g.normal)),
    },
    {
      label: t.wide,
      n: g.wide.length,
      hits: g.wide.filter((d) => d.bothBroke).length,
      detail: t.wideDetail(extRate(g.wide)),
    },
  ]
}

/** One row of card 9's width-range table (`:1723–1734`). */
export interface WidthRangeRow {
  label: 'NARROW' | 'NORMAL' | 'WIDE'
  color: string
  range: string
  mean: string
  days: number
  share: string
}

/** Shares are over `wd` — the BUCKETED days, not all days. */
export function widthRangeRows(g: OwnerGroups): WidthRangeRow[] {
  const sets: [WidthRangeRow['label'], SlimDay[]][] = [
    ['NARROW', g.narrow],
    ['NORMAL', g.normal],
    ['WIDE', g.wide],
  ]
  return sets.map(([label, a]) => ({
    label,
    color: WIDTH_BUCKET_COLORS[label],
    range: wRange(a),
    mean: a.length ? `${f2(avg(a.map((d) => d.width)))} pts` : EM_DASH,
    days: a.length,
    share: pct(a.length, g.wd.length),
  }))
}

/**
 * CARD 10 — rule 5, breakout entry.
 *
 * BUG (v2): the third row's `hits` is the literal 0 (`WICK_ONLY_HITS`), so its
 * Rate cell always reads "0.0%" in the down colour beside two measured rates.
 * Ported as written — see Q6.
 */
export function rule5Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule5.rows
  return [
    {
      label: t.surge,
      n: g.volYes.length,
      hits: g.volYes.filter((d) => d.fcb?.hit['1']).length,
      detail: t.mfeMae(
        avg(g.volYes.map((d) => d.fcb?.rExt ?? 0)),
        avg(g.volYes.map((d) => d.fcb?.rAdv ?? 0)),
      ),
    },
    {
      label: t.noSurge,
      n: g.volNo.length,
      hits: g.volNo.filter((d) => d.fcb?.hit['1']).length,
      detail: t.mfeMae(
        avg(g.volNo.map((d) => d.fcb?.rExt ?? 0)),
        avg(g.volNo.map((d) => d.fcb?.rAdv ?? 0)),
      ),
    },
    { label: t.wickOnly, n: g.wickOnly.length, hits: WICK_ONLY_HITS, detail: t.wickOnlyDetail },
  ]
}

/** CARD 11 — rule 6. The two indented rows are conditioned on the FAILED set. */
export function rule6Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule6.rows
  return [
    { label: t.fails, n: g.fcb.length, hits: g.failed.length, detail: t.failsDetail },
    {
      label: t.mid,
      indent: true,
      n: g.failed.length,
      hits: g.failed.filter((d) => d.fcb?.fadeMid).length,
      detail: t.midDetail,
    },
    {
      label: t.opp,
      indent: true,
      n: g.failed.length,
      hits: g.failed.filter((d) => d.fcb?.fadeOpp).length,
      detail: t.oppDetail,
    },
  ]
}

/** CARD 12 — rule 7. The control row's `n` is `N − fv.length`. */
export function rule7Rows(days: readonly SlimDay[], g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule7.rows
  const hitExt = (d: SlimDay): boolean => (d.fvg === 'bull' ? d.touchedH : d.touchedL)
  return [
    {
      label: t.bull,
      n: g.fvB.length,
      hits: g.fvB.filter(hitExt).length,
      // `fvgHitMid` is the second export-only field — see Q3.
      detail: t.midDetail(pct(g.fvB.filter((d) => d.fvgHitMid).length, g.fvB.length)),
    },
    {
      label: t.bear,
      n: g.fvS.length,
      hits: g.fvS.filter(hitExt).length,
      detail: t.midDetail(pct(g.fvS.filter((d) => d.fvgHitMid).length, g.fvS.length)),
    },
    {
      label: t.dir,
      n: g.fv.length,
      hits: g.fv.filter((d) => d.firstTouchSide === (d.fvg === 'bull' ? 'H' : 'L')).length,
      detail: t.dirDetail,
    },
    {
      label: t.control,
      n: g.N - g.fv.length,
      hits: days.filter((d) => !d.fvg && d.singleBreak).length,
      detail: t.controlDetail,
    },
  ]
}

/**
 * CARD 13 — rule 8.
 *
 * THE TWO POPULATIONS ARE NOT COMPLEMENTARY: `rt` is breaks that retested,
 * `noRt` is breaks that neither retested NOR failed, so a failed-and-not-
 * retested day is in neither row and the two `n`s do not add to `fcb.length`.
 */
export function rule8Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule8.rows
  return [
    {
      label: t.retest,
      n: g.rt.length,
      hits: g.rt.filter((d) => d.fcb?.retestCont).length,
      detail: t.mfe(avg(g.rt.map((d) => d.fcb?.rExt ?? 0))),
    },
    {
      label: t.noRetest,
      n: g.noRt.length,
      hits: g.noRt.filter((d) => d.fcb?.hit['1']).length,
      detail: t.noRetestDetail(avg(g.noRt.map((d) => d.fcb?.rExt ?? 0))),
    },
  ]
}

/** A fib card row, which may be a section header instead of a data row. */
export type FibEntry = { kind: 'section'; text: string } | ({ kind: 'row' } & StatRow)

/**
 * CARD 14 — the two 0.25-fib variants. The only card that uses section headers.
 *
 * Variant A's rows 2 and 3 are NOT mutually exclusive — a day can both continue
 * to a new extreme and later run through the midpoint — so they can sum past
 * 100%. Variant B carries only two rows because `fibB` stores only `hit` and
 * `cont`; its `fail` and `mfe` are hardcoded null in the exporter.
 */
export function fibEntries(g: OwnerGroups): FibEntry[] {
  const t = OWNER_CARDS.fib.rows
  return [
    { kind: 'section', text: OWNER_CARDS.fib.sectionA },
    { kind: 'row', label: t.aReach, n: g.fcb.length, hits: g.fA.length, detail: t.aReachDetail },
    {
      kind: 'row',
      label: t.cont,
      indent: true,
      n: g.fA.length,
      hits: g.fA.filter((d) => d.fcb?.fibA.cont).length,
      detail: t.contDetail,
    },
    {
      kind: 'row',
      label: t.aFail,
      indent: true,
      n: g.fA.length,
      hits: g.fA.filter((d) => d.fcb?.fibA.fail).length,
      detail: t.aFailDetail,
    },
    {
      kind: 'row',
      label: t.aNone,
      n: g.fcb.length,
      hits: g.fAno.length,
      detail: t.aNoneDetail(avg(g.fAno.map((d) => d.fcb?.rExt ?? 0))),
    },
    { kind: 'section', text: OWNER_CARDS.fib.sectionB },
    { kind: 'row', label: t.bReach, n: g.fcb.length, hits: g.fB.length, detail: t.bReachDetail },
    {
      kind: 'row',
      label: t.cont,
      indent: true,
      n: g.fB.length,
      hits: g.fB.filter((d) => d.fcb?.fibB.cont).length,
      detail: t.contDetail,
    },
  ]
}

/** CARD 14's footnote value: variant A's MFE, measured FROM the 0.25 entry. */
export const fibFootnoteMfe = (g: OwnerGroups): number | null =>
  avg(g.fA.map((d) => d.fcb?.fibA.mfe ?? 0))

/** CARD 15 — rule 9, the four extension targets. */
export function rule9Rows(g: OwnerGroups): StatRow[] {
  const avgW = avg(g.widths)
  return EXT_MULTIPLES.map((t) => ({
    label: OWNER_CARDS.rule9.rowLabel(t),
    n: g.fcb.length,
    hits: g.fcb.filter((d) => d.fcb?.hit[String(t)]).length,
    detail: OWNER_CARDS.rule9.rowDetail(avgW, t),
  }))
}

/**
 * CARD 16 — rule 10, close location.
 *
 * The MIDDLE row's comparison is `firstTouchSide === bias`, which counts
 * `null === null` as a HIT: a session with neither a bias nor a first touch
 * scores as correct. Transcribed as written.
 */
export function rule10Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule10.rows
  return [
    {
      label: t.top,
      n: g.top.length,
      hits: g.top.filter((d) => d.firstTouchSide === 'H').length,
      detail: t.plainZone,
    },
    {
      label: t.topStrong,
      indent: true,
      n: g.topStrong.length,
      hits: g.topStrong.filter((d) => d.firstTouchSide === 'H').length,
      detail: t.singleBreak(pct(g.topStrong.filter((d) => d.singleBreak).length, g.topStrong.length)),
    },
    {
      label: t.bot,
      n: g.bot.length,
      hits: g.bot.filter((d) => d.firstTouchSide === 'L').length,
      detail: t.plainZone,
    },
    {
      label: t.botStrong,
      indent: true,
      n: g.botStrong.length,
      hits: g.botStrong.filter((d) => d.firstTouchSide === 'L').length,
      detail: t.singleBreak(pct(g.botStrong.filter((d) => d.singleBreak).length, g.botStrong.length)),
    },
    {
      label: t.mid,
      n: g.midz.length,
      hits: g.midz.filter((d) => d.firstTouchSide === d.bias).length,
      detail: t.midDetail,
    },
  ]
}

/**
 * CARD 17 — rule 11, open type.
 *
 * THE POPULATION IS `wd`, THE BUCKETED DAYS — not `days`. An open type with no
 * matching bucketed session emits NO ROWS AT ALL, not an empty one, and the
 * sub-rows appear only when their own subset is non-empty.
 */
export function rule11Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule11.rows
  return OPEN_TYPES.flatMap((ot) => {
    const grp = g.wd.filter((d) => d.openType === ot)
    if (!grp.length) return []
    const gn = grp.filter((d) => d.widthBucket === 'narrow')
    const gw = grp.filter((d) => d.widthBucket === 'wide')
    const out: StatRow[] = [
      {
        label: t.all(ot),
        n: grp.length,
        hits: grp.filter((d) => d.singleBreak).length,
        detail: t.allDetail,
      },
    ]
    if (gn.length) {
      out.push({
        label: t.narrow(ot),
        indent: true,
        n: gn.length,
        hits: gn.filter((d) => d.singleBreak).length,
        detail: t.narrowDetail,
      })
    }
    if (gw.length) {
      out.push({
        label: t.wide(ot),
        indent: true,
        n: gw.length,
        // The WIDE sub-row scores BOTH-sides, not single-break — the rotation thesis.
        hits: gw.filter((d) => d.bothBroke).length,
        detail: t.wideDetail,
      })
    }
    return out
  })
}

/** CARD 18 — rule 12, ORB alignment. The detail column is the single-break rate. */
export function rule12Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule12.rows
  return [
    {
      label: t.aligned,
      n: g.align.length,
      hits: g.align.filter((d) => d.firstTouchSide === d.bias).length,
      detail: pct(g.align.filter((d) => d.singleBreak).length, g.align.length),
    },
    {
      label: t.conflicted,
      n: g.oppose.length,
      hits: g.oppose.filter((d) => d.firstTouchSide === d.bias).length,
      detail: pct(g.oppose.filter((d) => d.singleBreak).length, g.oppose.length),
    },
  ]
}

/**
 * CARD 19 — rule 13, the five break windows plus the before-noon cut.
 * Bounds are `>= a` and `< b`; the last window ends at 961 so a 16:00 break
 * counts (see breakTimeWindows).
 */
export function rule13Rows(g: OwnerGroups, rEnd: number): StatRow[] {
  const rows: StatRow[] = breakTimeWindows(rEnd).map(([a, b, label]) => {
    const grp = g.fcb.filter((d) => {
      const m = d.fcb?.breakMin ?? -1
      return m >= a && m < b
    })
    return {
      label,
      n: grp.length,
      hits: grp.filter((d) => d.fcb?.hit['1']).length,
      detail: OWNER_CARDS.rule13.rowDetail(
        avg(grp.map((d) => d.fcb?.rExt ?? 0)),
        pct(grp.filter((d) => d.fcb?.failed).length, grp.length),
      ),
    }
  })
  rows.push({
    label: OWNER_CARDS.rule13.beforeNoon,
    n: g.byNoon.length,
    hits: g.byNoon.filter((d) => d.fcb?.hit['1']).length,
    detail: OWNER_CARDS.rule13.beforeNoonDetail,
  })
  return rows
}

/** CARD 20 — rule 14. The two indented rows are exact complements: they sum to 100.0%. */
export function rule14Rows(g: OwnerGroups): StatRow[] {
  const t = OWNER_CARDS.rule14.rows
  return [
    { label: t.contained, n: g.N, hits: g.cont.length, detail: t.containedDetail },
    {
      label: t.stays,
      indent: true,
      n: g.cont.length,
      hits: g.cont.filter((d) => !d.containedBrokeLate).length,
      detail: t.staysDetail,
    },
    {
      label: t.breaks,
      indent: true,
      n: g.cont.length,
      hits: g.cont.filter((d) => d.containedBrokeLate).length,
      detail: t.breaksDetail,
    },
  ]
}

/** CARD 11's and CARD 15's footnote values, which are averages over a group. */
export const failPeakPts = (g: OwnerGroups): number | null =>
  avg(g.failed.map((d) => d.fcb?.peakBeforeFail ?? 0))
export const allBreaksMfe = (g: OwnerGroups): number | null =>
  avg(g.fcb.map((d) => d.fcb?.rExt ?? 0))
export const allBreaksMae = (g: OwnerGroups): number | null =>
  avg(g.fcb.map((d) => d.fcb?.rAdv ?? 0))

// ─────────────────────────────────────────────────────────────────────────────
// DEAD BUT FULLY BUILT — rendered by nothing in v2.
//
// `LiveToday` returns exactly three cards (`IbStatsTab.tsx:426–443`), and these
// two are not among them. The logic is transcribed rather than dropped because
// losing a fully-built card silently is the failure this port exists to prevent;
// deciding to keep it silently is the other one. Step 3 decides.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notWiredInV2
 *
 * "IN PLAY RIGHT NOW" — `RuleBoard` (`IbStatsTab.tsx:1097–1202`). A complete
 * card: 7 stat tiles, a 4-column table split by two section headers, a
 * three-sentence footnote. RENDERS NOWHERE IN v2.
 *
 * It is the ONLY consumer of `live.status` and of the `sideChip` helper, both of
 * which die with it. It also differs from the family board in one substantive
 * way: it drops NOT-IN-PLAY rules entirely ("a trigger that's absent today is
 * noise on a live board") and shows IN PLAY and PENDING in separate sections.
 */
export function ruleBoardRows(rules: readonly LiveRule[], days: readonly SlimDay[]): {
  inPlay: (LiveRule & { n: number; hits: number; p: number | null })[]
  pending: (LiveRule & { n: number; hits: number; p: number | null })[]
} {
  const scored = rules.map((r) => {
    const cond = r.cond
    const outcome = r.outcome
    if (!cond || !outcome) return { ...r, n: 0, hits: 0, p: null as number | null }
    const g = days.filter(cond)
    const hits = g.filter(outcome).length
    return { ...r, n: g.length, hits, p: g.length ? (100 * hits) / g.length : null }
  })
  return {
    inPlay: scored.filter((r) => r.state === 'in-play'),
    pending: scored.filter((r) => r.state === 'pending'),
  }
}

/** @notWiredInV2 — every string `RuleBoard` would paint. */
export const RULE_BOARD_TEXT = {
  accent: 'green',
  title: (win: IbWindow): string =>
    `In Play Right Now — live & forming rules against today's ${winLabel(win)} (${winRange(win)} ET)`,
  subtitleForming: (win: IbWindow): string =>
    `${winLabel(win)} STILL FORMING — every read below is CONDITIONAL: this is what the rules would say if the range closed where it stands right now. They can still flip before ${clock(rangeEnd(win))} ET.`,
  subtitleFormed: (win: IbWindow): string =>
    `${winLabel(win)} FORMED — each rule scored against every past session that matched today's condition`,
  head: ['Rule', 'Live read', 'Points to', 'Hit rate'],
  sectionInPlayForming: (n: number): string => `IN PLAY (conditional — if the IB formed now) · ${n}`,
  sectionInPlay: (n: number): string => `IN PLAY · ${n}`,
  sectionPending: (n: number): string =>
    `PENDING — not triggered yet, here are the odds IF it fires · ${n}`,
  chance: 'chance ',
  tiles: {
    price: 'Live price',
    dayRange: (lo: number, hi: number): string => `day range ${f2(lo)} – ${f2(hi)}`,
    high: (win: IbWindow): string => `${winLabel(win)} High`,
    low: (win: IbWindow): string => `${winLabel(win)} Low`,
    mid: (win: IbWindow): string => `${winLabel(win)} Mid`,
    width: (win: IbWindow): string => `${winLabel(win)} Width`,
    status: 'Status',
    aboveMid: 'price above mid',
    belowMid: 'price below mid',
    forming: 'FORMING',
    formed: 'FORMED',
    noBreakYet: 'no close outside yet',
  },
  footnote:
    'Every % is a conditional base rate, not a prediction — “on the past sessions that looked like this one, how often did it happen?” PENDING rules haven’t triggered yet (they need a break to print or the 14:00 bell) — their % is the if it fires rate, conditioned on today’s IB and the side it leans toward. Rules whose trigger is absent today are hidden — this board only shows what’s forming or live.',
} as const

/** One `PlaybookLegacy` card. @notWiredInV2 */
export interface LegacySetup {
  label: string
  question: string
  cond: (d: SlimDay) => boolean
  outcome: (d: SlimDay) => boolean
  side?: 'H' | 'L'
}

/**
 * @notWiredInV2
 *
 * `PlaybookLegacy` (`IbStatsTab.tsx:1206–1352`) — marked `@deprecated` in its own
 * docblock, wrapped in an `eslint-disable`, rendered by nothing. Superseded by
 * `RuleBoard`, which is itself unrendered.
 *
 * Builds up to ELEVEN condition cards from today's live state, filters to
 * `n >= 15`, sorts by rate descending, and flags anything under 40 as a thin
 * sample. Its border rule is a FOURTH rate ladder (`playbookBorder` below) —
 * same 60/40 boundaries, different neutral.
 *
 * Transcribed for the record. If v3 wants a playbook, it should be written
 * against `buildRules`' row list, not revived from here.
 */
export function playbookSetups(live: LiveSession, dowName: string): LegacySetup[] {
  const bias = live.bias
  const first = live.first
  const zone = live.zone
  const bucket = live.bucket
  const orbDir = live.orbDir
  const dowIdx = DOW_NAMES.indexOf(dowName as (typeof DOW_NAMES)[number])
  const bucketKey = bucketKeyOf(bucket)
  const setups: LegacySetup[] = []

  if (bias) {
    setups.push({
      label: `IB closed ${bias === 'H' ? 'ABOVE' : 'BELOW'} the midpoint`,
      question: `${W(bias)} breaks first`,
      cond: (d) => d.bias === bias,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    })
    setups.push({
      label: `Midpoint bias = ${bias === 'H' ? 'LONG' : 'SHORT'}`,
      question: `IB ${W(bias)} breaks at all today`,
      cond: (d) => d.bias === bias,
      outcome: (d) => (bias === 'H' ? d.touchedH : d.touchedL),
      side: bias,
    })
    setups.push({
      label: `${W(first)} formed first + close ${bias === 'H' ? 'above' : 'below'} mid`,
      question: `${W(bias)} breaks first`,
      cond: (d) => d.bias === bias && d.first === first,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    })
    setups.push({
      label: `IB close in the ${ZONE_WORD[zone]} + ${W(first)} first`,
      question: `${W(bias)} breaks first`,
      cond: (d) => d.closeZone === zone && d.first === first,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    })
  }

  if (bucketKey) {
    setups.push({
      label: `${bucket} IB width`,
      question: 'only ONE side breaks (single-break day)',
      cond: (d) => d.widthBucket === bucketKey,
      outcome: (d) => d.singleBreak,
    })
    setups.push({
      label: `${bucket} IB width`,
      question: 'BOTH sides break (rotation — fade the break)',
      cond: (d) => d.widthBucket === bucketKey,
      outcome: (d) => d.bothBroke,
    })
    setups.push({
      label: `${bucket} IB width`,
      question: 'the break runs ≥ 1× IB width',
      cond: (d) => d.widthBucket === bucketKey && !!d.fcb,
      outcome: (d) => !!d.fcb?.hit['1'],
    })
  }

  if (orbDir && bias) {
    setups.push({
      label:
        orbDir === bias
          ? `ORB broke ${W(orbDir)} — ALIGNED with the IB bias`
          : `ORB broke ${W(orbDir)} — CONFLICTS with the IB bias`,
      question: `${W(bias)} breaks first`,
      cond: (d) => d.bias === bias && d.orbDir === orbDir,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    })
  }

  if (dowIdx >= 1 && dowIdx <= 5) {
    setups.push({
      label: `It's ${dowName}`,
      question: 'only ONE side breaks',
      cond: (d) => dowOf(d) === dowIdx,
      outcome: (d) => d.singleBreak,
    })
  }

  if (bias && bucketKey) {
    const stack = `ALL OF IT: ${W(first)} first + ${bias === 'H' ? 'above' : 'below'} mid + ${bucket} IB`
    setups.push({
      label: stack,
      question: `${W(bias)} breaks first`,
      cond: (d) => d.bias === bias && d.first === first && d.widthBucket === bucketKey,
      outcome: (d) => d.firstTouchSide === bias,
      side: bias,
    })
    setups.push({
      label: stack,
      question: 'the break fails and closes back inside within 30m',
      cond: (d) =>
        d.bias === bias && d.first === first && d.widthBucket === bucketKey && !!d.fcb,
      outcome: (d) => !!d.fcb?.failed,
    })
  }

  return setups
}

/** @notWiredInV2 — the fourth rate ladder, `PlaybookLegacy`'s card border (`:1329`). */
export function playbookBorderColor(p: number | null): string {
  if (p != null && p >= 60) return V2.up
  if (p != null && p <= 40) return V2.red
  // v2's neutral here is `rgba(255,255,255,0.08)`, not the warn colour the other
  // three ladders use. Step 3 supplies the wash; the boundary logic is the point.
  return T.border
}

/** @notWiredInV2 — its filter, sort and thin-sample flag. */
export const PLAYBOOK_LEGACY = {
  minSample: SAMPLE_FLOORS.playbookLegacy,
  thinSampleUnder: MIN_N,
  thinSampleLabel: 'thin sample',
  accent: 'green',
  title: "In Play Right Now — what today's IB is setting up",
  subtitleComplete:
    "Every % below is today's live condition, scored against every past session that looked the same",
  subtitleForming: 'IB STILL FORMING — these conditions can still flip before 10:30 ET',
  chance: 'chance ',
  footnote:
    'These are conditional base rates, not predictions — each card asks “on the days that looked exactly like today, how often did this happen?” Cards with fewer than 40 matching sessions are flagged thin; the tighter the condition stack, the smaller the sample, so the “ALL OF IT” cards are the most specific and the least reliable at once.',
} as const
