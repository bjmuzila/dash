// ─────────────────────────────────────────────────────────────────────────────
// THE GEX LEVELS TAB — types, maths, copy, card registry and persistence.
//
// Transcribed 1:1 from v2's `components/scanner/GexLevelsTab.tsx` (all 2233
// lines), `components/dashboard/VolGexFlowPanel.tsx` (card 12, all 612 lines)
// and `hooks/useRefreshButton.ts`, against the checklist in
// docs/parity/scanner.md Part B, rows B1–B335.
//
// Nothing below was re-derived from the spec table. Every boundary, every
// weight, every wording is the v2 value, opened and copied.
//
// TEN pieces of business logic that are NOT obvious from the screen:
//
//   1. THE OI+VOL BASIS. Every gamma surface on this tab values a strike at
//      `netGEX + netVolGEX` (`oiVolNet`) — open interest AND volume. The walls,
//      the flip, $Gamma and both EOD columns are all on that basis, which is
//      why they are comparable. The 0DTE NET DELTA card is the one exception:
//      it is `netDEX` alone (basis "oi"). `dexOf` exists as ONE accessor so the
//      two delta cards can never silently drift onto different bases again.
//
//   2. THE CUMULATIVE CURVE IS COMPUTED OVER THE WHOLE CHAIN, then windowed for
//      display. Running it over the visible slice instead would move the zero
//      crossing off the real gamma flip, which is the entire point of the
//      chart. `cumulativeByStrike` therefore takes the full row set.
//
//   3. ZERO COUNTS AS POSITIVE, three times over, and each one is load-bearing:
//      `curveSignOf(0) === 1` (the curve paints up-colour at exactly zero),
//      the EOD bar ladder is `v >= 0`, and card 12's flip counter treats `0` as
//      the positive side. Do not "fix" one without the other two.
//
//   4. THE SIGN SEGMENTS INTERPOLATE THEIR OWN CROSSING. `signSegments` inserts
//      a synthetic point at cum === 0 between the two listed strikes that
//      straddle it, so the colour flips exactly at the flip rather than at the
//      next strike in the chain.
//
//   5. TODAY'S HISTORY ROW IS REWRITTEN ON A FIVE-FIELD TEST ONLY (B147):
//      resistance, support, neutral, a 1M step in $Gamma, or a 0.02 step in
//      CPG. `spot`, `r2`, `s2`, `openInt` and `curve` are written at the same
//      time but are NOT in the test, so those five cells can sit stale for a
//      whole session while the row looks live. That is v2's behaviour and it is
//      an open question in the spec, not something to quietly change here.
//
//   6. TWO MAGNITUDE FORMATTERS, KEPT (B12 vs B320). `fmtBn` ("1.24bn",
//      "412.7M", ASCII minus, no K or T tier) formats every SVG axis, tooltip
//      and history cell on cards 1–11. `fmtGex` ("1.24B", "−413K", U+2212
//      minus, T/B/M/K) formats card 12's six tiles and its price axis. They are
//      DIFFERENT COLUMNS, not a duplication: card 12 is a shared component —
//      the same panel renders on /home, where `fmtGex` mirrors the Levels
//      strip's `fmtMoneyB`. Collapsing them here would silently re-format the
//      home page. Spec open question 10 asks Brandon which becomes the house
//      format; until that is answered both ship, and both are exported so the
//      question can be settled in one edit.
//
//   7. THE 15s AND 60s POLLS ARE NOT ARBITRARY. /proxy/gex is a live 0DTE feed
//      (15s); /proxy/gex-by-strike-multi is one upstream fetch PER EXPIRATION
//      and is server-cached ~60s, so polling it faster buys a cached body.
//      /proxy/gex-vol-flow polls at 15s = half its 30s bucket, so a newly
//      written bucket appears within one poll instead of up to a bucket late.
//
//   8. OPRA OPEN INTEREST IS A ONCE-DAILY VALUE, posted ~06:30 ET and
//      reflecting the prior close. The OI-by-expiration card therefore does not
//      ride the 15s poll at all: it caches per ET DAY in localStorage and only
//      the card's own Refresh forces a re-pull.
//
//   9. A SESSION WITH A NULL ON THE CHOSEN EOD BASIS IS DROPPED, never plotted
//      as zero, and the count of dropped sessions is disclosed in the status
//      line — "a silently short chart reads as 'the market was quiet', not as
//      'those rows have no value for this column yet'".
//
//  10. CARD 12'S % SERIES AUTOSCALE ALWAYS CONTAINS 50. Pure data-fit would
//      make a 58–64 day look like a regime war; a hard 0–100 would flatten the
//      same day into a straight line. `pctAutoscaleRange` pads by 5 either side
//      of the data, clamps to 0–100, and forces 50 inside the range.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// Both departures are in the DATA layer and are documented in full in
// gexLevelsData.ts: the /proxy/gex → /api/chains waterfall, and /api/eod-gex
// being requested twice on every mount. This file's job is to make them
// possible — `oiExpiryTargets()` takes the expiration list as an ARGUMENT
// rather than reaching for a snapshot, and there is exactly one `EOD_GEX_DAYS`
// / one parse for both EOD cards to read.
//
// The COLOUR COLLAPSE (v3 non-negotiable 1) is applied at the ladder call
// sites, each one commented:
//   • v2 painted "positive" THREE ways on one screen — `#22C55E` on the gamma
//     surfaces, `#7dd3fc` on the delta/OI/EOD surfaces, `#8ECAE6` on card 12's
//     flow series — and each one carries a code comment defending it against
//     the other two. Wherever the value is a SIGN it is MOVE_UP here, once.
//   • Wherever `#7dd3fc` is an ACCENT or a LEG IDENTITY rather than a sign
//     (the Resistance tile, the call leg, the OI bars — OI is never negative,
//     the CPG gauge's balanced middle band, the spot line) it stays LIGHT_BLUE.
//   • Every v2 negative (`#EF4444`) is MOVE_DOWN.
//   • THE SPOT LINE had three treatments (LIGHT_BLUE @.6, LIGHT_BLUE @.75,
//     white @.6). One here: `SPOT_LINE`.
//   • THE FLIP LINE had three (white "2 3" @.55, green "4 3" @.55, white "2 2"
//     @.45). One here: `FLIP_LINE`, on v2's majority treatment. `VIOLET` — v3's
//     "this is a gamma flip" token — was the other candidate and is NOT taken,
//     because it would introduce a hue this tab never painted.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `EOD_GEX_FIELD_META.totalGex` — the "legacy, mixed basis" third EOD basis
//   (v2 :1069–1073), together with the `field = "totalGex"` DEFAULT on both
//   `EodGexPanel` and `EodGexBarChart`. Genuinely dead: both call sites pass an
//   explicit basis, so the strings "Net GEX (legacy, mixed basis)",
//   "no eod_gex rows" and "eod_gex.total_gex — basis varies by source,
//   reference only" never rendered. Its column is not chartable as one series
//   at all — `eod_gex.total_gex`'s basis depends on which writer touched the
//   row last. `EodGexField` here is a two-member union, and `EodGexRow` no
//   longer carries `totalGex`, which existed only to feed this branch.
// • `GexLevelsRow.callVolume` / `putVolume` (v2 :96–97). Declared on the wire
//   type, zero-filled by `multiRow`, read by nothing in 2233 lines.
// • `useChartPan`'s `zoom` return value (v2 :380). Returned and never read —
//   all four consumers use `winHalf`, which already folds the zoom in. `zoom`
//   survives here as an ARGUMENT to `panWinHalf`, which is the only place it
//   ever mattered.
// • `ColumnDropZone`'s `active={false}` branch (v2 :1897). The only call site
//   hardcodes `active={true}`, so the dimmer opacity was unreachable.
// • The module header comment at v2 :69–90. It advertises "ITM toggles" and a
//   "strike table" that do not exist anywhere in the file, and describes the
//   history and OI-by-expiration panels as both unbuilt and built two lines
//   apart. Test-Lab-era text that survived the 2026-08-16 move.
// • The `gl` / `Gl` symbol prefix on twenty-odd helpers, and the `AmTbrStat`
//   name. Both were collision-avoidance inside one big TestLab module that no
//   longer exists; `AmTbrStat`'s doc comment describes an AM TBR feature that
//   now lives on /es-candles.
//
// Spec: docs/parity/scanner.md Part B, rows B1–B335.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, alpha, tokenHex, tokenHexAlpha } from '@/design/theme'
import { EM_DASH, fmtInt } from '@/pages/scanner/format'
import type { ScannerTabId } from '@/pages/scanner/scannerNav'

// ─────────────────────────────────────────────────────────────────────────────
// § 1 — TAB IDENTITY (B1–B7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tab's id in the scanner registry. Label, accent, icon and the owner gate
 * all live in `scannerNav` — this tab is NOT owner-gated and nothing on it is
 * conditional on the owner check.
 */
export const GEX_LEVELS_TAB_ID: ScannerTabId = 'gexlevels'

/** Fallback symbol for every "which instrument is this" string on the tab. */
export const DEFAULT_SYMBOL = 'SPX'

// ─────────────────────────────────────────────────────────────────────────────
// § 2 — WIRE SHAPES AND DOMAIN TYPES (B18, B20, B115, B213–B215, B280, B284)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One strike from the live 0DTE feed.
 *
 * `volNetDEX` is optional only because older localStorage cache shapes predate
 * it; /proxy/gex has always shipped it and /proxy/gex-by-strike-multi has since
 * 2026-08.
 */
export interface GexLevelsRow {
  strike: number
  callOI: number
  putOI: number
  callGEX: number
  putGEX: number
  netGEX: number
  netVolGEX: number
  netDEX: number
  volNetDEX?: number
}

export interface GexLevelsSnapshot {
  symbol?: string
  spot?: number
  expiry?: string
  expirations?: string[]
  gexRows?: GexLevelsRow[]
  callWall?: number | null
  putWall?: number | null
  gexFlip?: number | null
  totalNetGex?: number | null
  updatedAt?: number | null
}

export interface GexLevelsDerived {
  rows: GexLevelsRow[]
  spot: number
  resistance: number | null
  support: number | null
  neutral: number | null
  dollarGamma: number
  cpgRatio: number
  r2: number | null
  s2: number | null
  totalCallOI: number
  totalPutOI: number
}

/** Which leg(s) a net-delta surface values a strike on. */
export type DexBasis = 'oi' | 'oivol'

/** A point on the cumulative gamma curve. */
export interface CurvePt {
  strike: number
  cum: number
}

/** The downsampled curve as it rides in localStorage and in the DB's JSONB. */
export interface CurvePoint {
  k: number
  c: number
}

export interface SignSegment {
  sign: 1 | -1
  pts: CurvePt[]
}

/** One session from `eod_gex`. See the REMOVED note about `total_gex`. */
export interface EodGexRow {
  date: string
  totalGexEx0dte: number | null
  totalGex0dte: number | null
  spot: number
}

/** The two bases that have exactly one definition each. */
export type EodGexField = 'totalGex0dte' | 'totalGexEx0dte'

export interface GexMultiLadder {
  rows: GexLevelsRow[]
  totalNetGex: number | null
  gexFlip: number | null
  /**
   * THIS ladder's own walls, added 2026-08. A server-v2 predating the change
   * omits them and they parse as null, which is why the header clause is
   * dropped entirely rather than printed as an em dash — see `multiStatusLine`.
   */
  callWall: number | null
  putWall: number | null
}

export interface GexMultiPayload {
  spot: number
  expiryCount: number
  all: GexMultiLadder
  ex0dte: GexMultiLadder
  /**
   * Parsed, and rendered NOWHERE in v2 — the three multi-expiry cards carry no
   * freshness stamp at all despite reading a body the server caches for 60s,
   * which the spec flags as arguably the bug (Part B "Do not port" 9). Kept
   * parsed so step 3 can decide to show it; drop all three if it decides not to.
   */
  sessionDate: string
  updatedAt: number
  cached: boolean
}

/** One day of the key-levels log. Date is `YYYY-MM-DD` in America/New_York. */
export interface HistoryEntry {
  date: string
  /** Last-updated ms. Ordering and merge tie-breaks only. */
  t: number
  spot: number
  resistance: number | null
  support: number | null
  neutral: number | null
  dollarGamma: number
  cpgRatio: number
  r2: number | null
  s2: number | null
  openInt: number
  /** null on rows recorded before the curve column existed. */
  curve?: CurvePoint[] | null
}

export interface OiByExpiryRow {
  expiry: string
  callOI: number
  putOI: number
}

export interface OiExpiryCache {
  date: string
  symbol: string
  rows: OiByExpiryRow[]
}

/**
 * One 30s bucket of card 12's flow series.
 *
 * `oiGex`, `combined`, `posGex` and `absGex` are on the wire and are read by
 * nothing — only `ts`, `spot`, `volGex`, `dVol`, `strikes` and `posPct` reach
 * the screen. They are kept on the type because the endpoint sends them and a
 * reader comparing the two should not have to wonder whether they were dropped
 * by accident.
 */
export interface VolFlowPoint {
  ts: number
  spot: number
  volGex: number
  oiGex: number
  combined: number
  dVol: number | null
  strikes: number
  posGex?: number
  absGex?: number
  /** Positive share of the bucket's |net GEX|, 0–100. null on a bucket with no rows. */
  posPct?: number | null
}

export interface ExpiryInfo {
  expiry: string
  rows: number
  lastTs: number
}

export interface VolFlowResponse {
  ok?: boolean
  reason?: string
  scope?: string
  session?: string
  expiry?: string | null
  binSec?: number
  expiries?: ExpiryInfo[]
  points?: VolFlowPoint[]
}

export type VolFlowSession = 'rth' | 'eth'

// ─────────────────────────────────────────────────────────────────────────────
// § 3 — FORMATTERS (B10–B15, B290, B320, B321)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rounded integer with the BROWSER's locale grouping: "6,412" in en-US,
 * "6.412" in de-DE. v2's `glFmt0`, which is `fmtInt` plus a finite guard.
 */
export function fmt0(n: number | null | undefined): string {
  return Number.isFinite(n) ? fmtInt(n as number) : EM_DASH
}

/** Exactly 2dp, NO thousands separator: "6412.50". v2's `glFmt2`. */
export function fmt2(n: number | null | undefined): string {
  return Number.isFinite(n) ? (n as number).toFixed(2) : EM_DASH
}

/**
 * v2's `glFmtBn` — the magnitude formatter for every axis, tooltip and history
 * cell on cards 1–11.
 *
 * Three branches on the ABSOLUTE value, both boundaries `>=`:
 *   >= 1e9 → "1.24bn"   (2dp, LOWERCASE suffix)
 *   >= 1e6 → "412.7M"   (1dp, UPPERCASE suffix)
 *   else   → "-412773"  (0dp, NO grouping at all)
 *
 * The mixed suffix case and the ungrouped small branch are v2's, copied. The
 * sign is whatever `toFixed` prints, i.e. an ASCII hyphen — which is what makes
 * this incompatible with `fmtGex` below. See header note 6.
 */
export function fmtBn(n: number | null | undefined): string {
  if (!Number.isFinite(n)) return EM_DASH
  const v = n as number
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}bn`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return v.toFixed(0)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * "2026-08-14" → "Aug 14, 2026". Returns the raw string unchanged when any part
 * is falsy — which covers "", NaN, AND a genuine month 0.
 */
export function fmtDate(ymd: string): string {
  const [y, m, day] = ymd.split('-').map(Number)
  if (!y || !m || !day) return ymd
  return `${MONTHS[m - 1] ?? ''} ${day}, ${y}`
}

/**
 * `fmtDate` with the year stripped — "Aug 14".
 *
 * v2 wrote this as `glFmtDate(r.date).replace(/, \d+$/, "")` at the OI-by-date
 * axis (B104), the tab's only call site. It is a LABEL RULE, so it lives beside
 * the formatter it wraps rather than in the render layer.
 */
export function fmtDateNoYear(ymd: string): string {
  return fmtDate(ymd).replace(/, \d+$/, '')
}

/** "2026-08-14" → "8/14". No zero padding, no year. Raw string on a miss. */
export function fmtExpiryLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return m && d ? `${m}/${d}` : ymd
}

/**
 * "2026-09-02" — today in America/New_York. `en-CA` purely because it yields
 * ISO ordering; nothing about this is Canadian.
 */
export function todayEtDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

/**
 * "03:41:07 PM" — forced ET, with seconds. The header card's "as of" stamp, and
 * the ONLY place on the tab that shows seconds.
 */
export function etClock(ms: number | null | undefined): string {
  if (!ms) return EM_DASH
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms))
}

/**
 * "03:41 PM" — forced ET, no seconds. Every panel's "Loaded … ET" stamp, card
 * 12's time axis, its tile sub-labels and its updated stamp.
 *
 * v2 built this two ways — `Intl.DateTimeFormat(...).format()` in
 * GexLevelsTab and `toLocaleTimeString(...)` in VolGexFlowPanel — with
 * identical options and therefore identical output. Merged into one function;
 * that is a consolidation, not a behaviour change.
 */
export function etHourMinute(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** The same, from a UNIX SECOND — card 12 works in seconds throughout. */
export function etTimeFromSec(sec: number): string {
  return etHourMinute(sec * 1000)
}

/**
 * "2026-07-31" → "Jul 31". Parsed at UTC NOON so the label cannot slip a day
 * west of UTC. Raw ISO string on a regex miss.
 */
export function shortExpiry(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m || !m[1] || !m[2] || !m[3]) return iso
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * v2's `fmtGex` — card 12's magnitude formatter, and the SECOND one on this
 * screen. See header note 6 for why both survive.
 *
 * Four tiers on the absolute value: T / B / M at `digits` dp, K at ZERO dp.
 * The sign is U+2212 MINUS SIGN, not an ASCII hyphen. The chart's price axis
 * calls it with digits = 1; the six tiles take the default 2.
 */
export function fmtGex(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`
  return `${sign}${a.toFixed(0)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 — ROW ACCESSORS (B16, B17)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The OI+Vol gamma basis used by EVERY gamma surface on this tab. A missing leg
 * counts as 0, not as "no data".
 */
export function oiVolNet(r: GexLevelsRow): number {
  return (r.netGEX ?? 0) + (r.netVolGEX ?? 0)
}

/**
 * Net delta on the chosen basis. Deliberately parallel to `oiVolNet`:
 *   "oi"     OI leg only — the 0DTE net-delta card, unchanged since it shipped.
 *   "oivol"  OI + volume — the same basis as every gamma ladder here.
 * ONE accessor so the two delta cards can never silently drift apart again.
 */
export function dexOf(r: GexLevelsRow, basis: DexBasis): number {
  const oi = r.netDEX ?? 0
  return basis === 'oi' ? oi : oi + (r.volNetDEX ?? 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5 — THE LIVE DERIVATION (B21–B29)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the header card and the four 0DTE cards read, from one snapshot.
 *
 * Returns null — which hides the whole card grid in v2 (B96) — when there are
 * no usable rows or spot is not strictly positive.
 *
 * Two quirks, both v2's and both deliberate here:
 *
 *   • `dollarGamma` prefers the server's `totalNetGex` and falls back to the
 *     client sum, silently. The UI never says which of the two it is showing.
 *   • `cpgRatio` returns 0 when the put book is empty, which the CPG gauge then
 *     paints in its RED left band — "maximally put-heavy" for a chain with no
 *     puts. Spec open question 5 asks whether null / an em dash is the right
 *     answer. Not decided here.
 */
export function deriveGexLevels(s: GexLevelsSnapshot | null): GexLevelsDerived | null {
  if (!s) return null
  // `r &&` first: a socket frame can carry a null hole in gexRows, and reading
  // .strike off it threw the "undefined (reading 'strike')" that killed the page.
  const rows = (s.gexRows ?? [])
    .filter((r) => r && Number.isFinite(r.strike))
    .slice()
    .sort((a, b) => a.strike - b.strike)
  const spot = Number(s.spot ?? 0)
  if (!rows.length || !(spot > 0)) return null

  const resistance = Number.isFinite(s.callWall) ? (s.callWall as number) : null
  const support = Number.isFinite(s.putWall) ? (s.putWall as number) : null
  const neutral = Number.isFinite(s.gexFlip) ? (s.gexFlip as number) : null
  const dollarGamma = Number.isFinite(s.totalNetGex)
    ? (s.totalNetGex as number)
    : rows.reduce((sum, r) => sum + oiVolNet(r), 0)

  let totalCallGEX = 0
  let totalPutGEXabs = 0
  let totalCallOI = 0
  let totalPutOI = 0
  for (const r of rows) {
    // Negative callGEX is clamped to 0; putGEX is taken as an absolute. The
    // ratio is call-gamma over put-gamma-magnitude, not a net.
    totalCallGEX += Math.max(0, r.callGEX ?? 0)
    totalPutGEXabs += Math.abs(r.putGEX ?? 0)
    totalCallOI += r.callOI ?? 0
    totalPutOI += r.putOI ?? 0
  }
  const cpgRatio = totalPutGEXabs > 0 ? totalCallGEX / totalPutGEXabs : 0

  // R2 / S2 — the 2nd-strongest wall each side. Same rule the server uses for
  // callWall/putWall (highest positive net GEX above spot, most negative below),
  // excluding whichever strike already won #1. All three conditions are strict.
  const above = rows
    .filter((r) => r.strike > spot && oiVolNet(r) > 0 && r.strike !== resistance)
    .sort((a, b) => oiVolNet(b) - oiVolNet(a))
  const below = rows
    .filter((r) => r.strike < spot && oiVolNet(r) < 0 && r.strike !== support)
    .sort((a, b) => oiVolNet(a) - oiVolNet(b))

  return {
    rows,
    spot,
    resistance,
    support,
    neutral,
    dollarGamma,
    cpgRatio,
    r2: above[0]?.strike ?? null,
    s2: below[0]?.strike ?? null,
    totalCallOI,
    totalPutOI,
  }
}

/** Contracts, both sides. The only consumer of the two OI totals (B28). */
export function openInterestTotal(d: GexLevelsDerived): number {
  return d.totalCallOI + d.totalPutOI
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 — THE CUMULATIVE CURVE (B72–B76)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Running sum of net GEX from the LOWEST strike in the full chain upward — the
 * exact maths server-side `findGexFlip` uses. Computed over the WHOLE chain,
 * never the visible slice, so the crossing lands on the real flip. See header
 * note 2.
 */
export function cumulativeByStrike(rows: GexLevelsRow[]): CurvePt[] {
  const sorted = rows.slice().sort((a, b) => a.strike - b.strike)
  let cum = 0
  return sorted.map((r) => {
    cum += oiVolNet(r)
    return { strike: r.strike, cum }
  })
}

/** ZERO COUNTS AS POSITIVE. See header note 3. */
export function curveSignOf(v: number): 1 | -1 {
  return v >= 0 ? 1 : -1
}

/**
 * Split a cumulative curve into contiguous same-sign runs, inserting an
 * interpolated point at each zero crossing so the colour flips EXACTLY at the
 * flip instead of at the next listed strike. The crossing point ends the old
 * run and starts the new one, so there is no seam.
 *
 * Single-point runs are dropped at the end — a lone point cannot be stroked.
 */
export function signSegments(pts: CurvePt[]): SignSegment[] {
  if (pts.length < 2) return []
  const first = pts[0]
  if (!first) return []
  const segs: SignSegment[] = []
  let cur: SignSegment = { sign: curveSignOf(first.cum), pts: [first] }
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const p = pts[i]
    if (!prev || !p) continue
    const s = curveSignOf(p.cum)
    if (s !== cur.sign) {
      const dv = p.cum - prev.cum
      const frac = dv === 0 ? 0 : (0 - prev.cum) / dv
      const cross: CurvePt = { strike: prev.strike + (p.strike - prev.strike) * frac, cum: 0 }
      cur.pts.push(cross)
      segs.push(cur)
      cur = { sign: s, pts: [cross, p] }
    } else {
      cur.pts.push(p)
    }
  }
  segs.push(cur)
  return segs.filter((s) => s.pts.length > 1)
}

/**
 * How many points a stored curve is squeezed to. Small on purpose — it rides in
 * localStorage AND in the `gex_levels_history.curve` JSONB column.
 */
export const CURVE_POINTS = 48

/**
 * Downsample a cumulative curve to at most `CURVE_POINTS`, rounding the strike
 * to 2dp and the cumulative to a whole dollar.
 */
export function downsampleCurve(pts: CurvePt[]): CurvePoint[] {
  if (!pts.length) return []
  const at = (p: CurvePt): CurvePoint => ({ k: Number(p.strike.toFixed(2)), c: Math.round(p.cum) })
  if (pts.length <= CURVE_POINTS) return pts.map(at)
  const step = (pts.length - 1) / (CURVE_POINTS - 1)
  const out: CurvePoint[] = []
  for (let i = 0; i < CURVE_POINTS; i++) {
    const p = pts[Math.round(i * step)]
    if (p) out.push(at(p))
  }
  return out
}

/** The stored `{k,c}` shape back to the `{strike,cum}` the segment maths wants. */
export function curveToPts(curve: CurvePoint[]): CurvePt[] {
  return curve.map((p) => ({ strike: p.k, cum: p.c }))
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 — PAN, ZOOM AND WINDOWING (B67–B71, B194, B195, B226, B235)
//
// The four strike charts share one interaction model. This is its maths; the
// event wiring is step 3's.
// ─────────────────────────────────────────────────────────────────────────────

/** Wheel zoom ladder: one notch multiplies or divides by this. */
export const ZOOM_STEP = 1.15
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 8

/** ±6% of spot — the default window for the bars, call/put and delta charts. */
export const WINDOW_FRAC_DEFAULT = 0.06
/**
 * The cumulative 0DTE chart passes 1, i.e. a half-window of a whole spot —
 * wider than the entire listed chain, so every strike is visible on first paint
 * and zoom/pan work from there.
 */
export const WINDOW_FRAC_FULL_CHAIN = 1

/** A window leaving this many points or fewer falls back to the whole set. */
export const WINDOW_MIN_POINTS = 4

/** One wheel notch. `deltaY < 0` (scroll up) zooms IN. */
export function nextZoom(zoom: number, deltaY: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP))
}

/** Half-width of the visible strike window, floored at one strike unit. */
export function panWinHalf(spot: number, windowFrac: number, zoom: number): number {
  return Math.max((spot * windowFrac) / zoom, 1)
}

/**
 * Clamp a raw pan offset so the window stays inside the real chain.
 * A chain narrower than the window has nothing to pan and returns 0.
 */
export function clampPan(
  raw: number,
  opts: { spot: number; minStrike: number; maxStrike: number; winHalf: number },
): number {
  const lo = opts.minStrike + opts.winHalf
  const hi = opts.maxStrike - opts.winHalf
  if (lo > hi) return 0
  const center = Math.min(hi, Math.max(lo, opts.spot + raw))
  return center - opts.spot
}

/** Whether the chain is wide enough to pan at all — drives the grab cursor. */
export function canPan(minStrike: number, maxStrike: number, winHalf: number): boolean {
  return maxStrike - minStrike > winHalf * 2
}

/** Drag delta in PIXELS to a delta in strikes, given the current x scale. */
export function panDeltaStrikes(deltaPx: number, pxPerStrike: number): number {
  return pxPerStrike > 0 ? deltaPx / pxPerStrike : 0
}

/**
 * The visible slice, with v2's fallback: a window that would leave four points
 * or fewer shows the whole set instead.
 */
export function visibleWindow<Item>(
  all: Item[],
  center: number,
  winHalf: number,
  keyOf: (item: Item) => number,
): Item[] {
  const shown = all.filter((it) => keyOf(it) >= center - winHalf && keyOf(it) <= center + winHalf)
  return shown.length <= WINDOW_MIN_POINTS ? all : shown
}

/** Symmetric-about-zero domain: zero is ALWAYS inside, flat data gets ±1. */
export function domainWithZero(vals: number[]): { min: number; max: number } {
  let min = Math.min(0, ...vals)
  let max = Math.max(0, ...vals)
  if (min === max) {
    min -= 1
    max += 1
  }
  return { min, max }
}

/**
 * B235 — the call/put chart's domain, which is NOT `domainWithZero` over one
 * array: the two legs get SEPARATE extremes. Raw `putGEX` is negative and raw
 * `callGEX` positive by construction, so the puts define the floor and the
 * calls the ceiling and the two are never netted. Flat data gets ±1, the same
 * escape `domainWithZero` uses.
 */
export function callPutDomain(callVals: number[], putVals: number[]): { min: number; max: number } {
  let min = Math.min(0, ...putVals)
  let max = Math.max(0, ...callVals)
  if (min === max) {
    min -= 1
    max += 1
  }
  return { min, max }
}

/**
 * The cumulative chart pads its domain by 8% of the span on EACH side. The
 * bars, call/put and delta charts do not — they use `domainWithZero` raw. Note
 * the cumulative chart's AXIS LABELS print the UNPADDED extremes.
 */
export const CURVE_Y_PAD_FRAC = 0.08

export function padDomain(min: number, max: number, frac = CURVE_Y_PAD_FRAC): { min: number; max: number } {
  const span = max - min
  return { min: min - span * frac, max: max + span * frac }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8 — CHART GEOMETRY (B100, B128, B183, B192, B223, B234, B247, B164)
//
// SVG USER UNITS inside a `viewBox`, not CSS pixels — these are the coordinate
// system the scale functions below map into, and losing them would mean
// re-deriving every axis position. No CSS size, no type size, is named here.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartGeom {
  w: number
  h: number
  padL: number
  padR: number
  padB: number
  padT: number
}

export const CHART_GEOM = {
  /** Cards 6 (cumulative 0DTE gamma). */
  netGammaCurve: { w: 720, h: 220, padL: 54, padR: 16, padB: 26, padT: 18 },
  /** Cards 7 & 8 (multi-expiry gamma bars). */
  netGammaBars: { w: 720, h: 220, padL: 56, padR: 16, padB: 26, padT: 18 },
  /** Card 9 (call/put gamma). */
  callPutGamma: { w: 720, h: 220, padL: 54, padR: 16, padB: 26, padT: 18 },
  /** Cards 10 & 11 (net delta). */
  netDelta: { w: 720, h: 220, padL: 50, padR: 16, padB: 26, padT: 18 },
  /** Card 1 (OI by date). */
  oiByDate: { w: 720, h: 220, padL: 60, padR: 16, padB: 30, padT: 18 },
  /** Card 5's two mini charts. */
  oiByExpiry: { w: 340, h: 190, padL: 40, padR: 10, padB: 32, padT: 20 },
  /** Cards 2 & 3 (EOD GEX). */
  eodGex: { w: 700, h: 240, padL: 52, padR: 12, padB: 34, padT: 16 },
} as const satisfies Record<string, ChartGeom>

/** The history table's inline sparkline. `padY` is vertical inset, both ends. */
export const CURVE_SPARK_GEOM = { w: 104, h: 28, padY: 3 } as const

/** Plot width in user units. */
export function plotW(g: ChartGeom): number {
  return g.w - g.padL - g.padR
}

/** Baseline y for a chart whose zero sits at the bottom (OI charts). */
export function baselineY(g: ChartGeom): number {
  return g.h - g.padB
}

/** Linear x for a value domain `[lo,hi]`. A zero-width domain maps everything to padL. */
export function xScale(g: ChartGeom, lo: number, hi: number): (v: number) => number {
  return (v: number) => g.padL + ((v - lo) / (hi - lo || 1)) * plotW(g)
}

/** Pixels (user units) per strike, for the drag-pan conversion. */
export function pxPerStrike(g: ChartGeom, lo: number, hi: number): number {
  return plotW(g) / (hi - lo || 1)
}

/** Linear y for a value domain, inverted (max at the top). */
export function yScale(g: ChartGeom, min: number, max: number): (v: number) => number {
  return (v: number) => g.padT + (1 - (v - min) / (max - min)) * (g.h - g.padT - g.padB)
}

/** Bar width rules, per chart. Each is `slot * fraction`, floored. */
export const BAR_WIDTH = {
  /** Gamma bars and delta bars: 62% of the slot, min 2. */
  strikeBars: { fraction: 0.62, min: 2 },
  /** Call/put paired bars: 34% of the slot each, min 1.5, with a 1px gutter. */
  callPutPaired: { fraction: 0.34, min: 1.5 },
  /** EOD session bars: 60% of the slot, min 3. */
  eodSession: { fraction: 0.6, min: 3 },
  /** OI-by-expiry mini bars: 55% of the slot, min 3. */
  oiExpiry: { fraction: 0.55, min: 3 },
  /** OI-by-date bars: 50% of the slot, min 4. */
  oiDate: { fraction: 0.5, min: 4 },
} as const

export function barWidth(slotW: number, rule: { fraction: number; min: number }): number {
  return Math.max(rule.min, slotW * rule.fraction)
}

/**
 * The EOD chart's zero line floats so a sign flip is visible instead of being
 * squashed against an axis:
 *   both signs → mid-plot, each half gets half the height
 *   only negatives → the TOP, the whole height below it
 *   only positives → the BOTTOM, the whole height above it
 */
export function eodZeroLine(
  g: ChartGeom,
  vals: number[],
): { yZero: number; half: number; hasPos: boolean; hasNeg: boolean } {
  const plotH = g.h - g.padT - g.padB
  const hasNeg = vals.some((v) => v < 0)
  const hasPos = vals.some((v) => v > 0)
  const both = hasNeg && hasPos
  return {
    yZero: both ? g.padT + plotH / 2 : hasNeg ? g.padT : g.padT + plotH,
    half: both ? plotH / 2 : plotH,
    hasPos,
    hasNeg,
  }
}

/**
 * X-tick thinning rules — which index gets a label. Each chart has its own and
 * they genuinely differ:
 *   oiDate:   first, last, middle, or every bar when there are 8 or fewer
 *   oiExpiry: every `ceil(n/8)`-th, or every bar at 8 or fewer
 *   eodGex:   every `ceil(n/10)`-th, or every bar at 10 or fewer
 */
export function showTickOiDate(i: number, n: number): boolean {
  return n <= 8 || i === 0 || i === n - 1 || i === Math.floor(n / 2)
}
export function showTickEveryNth(i: number, n: number, cap: number): boolean {
  return n <= cap || i % Math.ceil(n / cap) === 0
}
export const TICK_CAP_OI_EXPIRY = 8
export const TICK_CAP_EOD = 10

// ─────────────────────────────────────────────────────────────────────────────
// § 9 — COLOUR LADDERS (B55, B56, B74, B103, B130, B182, B225, B237, B238, B248)
//
// The boundary is business logic and lives here; the value is a token. Every
// collapse against v2 is named at its call site.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sign colour for the cumulative curve and its area fill.
 * v2: `GEX_POS_GREEN` #22C55E / `HOME_THEME.red` #EF4444.
 * COLLAPSE: both are the sign semantic → MOVE_UP / MOVE_DOWN.
 */
export function signColor(sign: 1 | -1): string {
  return sign > 0 ? MOVE_UP : MOVE_DOWN
}

/** The 20%-alpha area fill under a curve segment. v2 appended a `33` hex byte. */
export function signAreaFill(sign: 1 | -1): string {
  return alpha(signColor(sign), 0.2)
}

/**
 * Per-strike gamma bars (cards 7 & 8). Boundary `>= 0`, so exactly zero is up.
 * v2: #22C55E / #EF4444 → the same collapse as `signColor`.
 */
export function gammaBarColor(v: number): string {
  return v >= 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * Net-delta bars (cards 10 & 11).
 * v2 painted POSITIVE here `LIGHT_BLUE` #7dd3fc and negative #EF4444 — the same
 * two-way SIGN ladder as the gamma bars, in different colours, on adjacent
 * cards. COLLAPSE: one positive semantic, one token → MOVE_UP / MOVE_DOWN.
 */
export function deltaBarColor(v: number): string {
  return v >= 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * EOD session bars (cards 2 & 3). Boundary `>= 0` — exactly zero paints up.
 * v2: `LIGHT_BLUE` / #EF4444. Same collapse as `deltaBarColor`.
 */
export function eodBarColor(v: number): string {
  return v >= 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * The call and put LEGS (card 9's paired bars, card 5's two mini charts).
 * These are not signs — raw callGEX is positive and raw putGEX negative by
 * construction — so the accent stays LIGHT_BLUE and only the put side collapses
 * onto MOVE_DOWN with every other v2 #EF4444.
 */
export const CALL_LEG_COLOR = LIGHT_BLUE
export const PUT_LEG_COLOR = MOVE_DOWN

/**
 * Open-interest bars (card 1). OI is never negative, so this is a SERIES colour
 * and not a ladder: it stays the accent.
 */
export const OI_BAR_COLOR = LIGHT_BLUE

/** Every error line on the tab. v2's HOME_THEME.red on all five. */
export const ERROR_INK = MOVE_DOWN

/**
 * THE SPOT MARKER — one treatment. v2 had three for the same mark: LIGHT_BLUE
 * at 0.6 on the cumulative chart, LIGHT_BLUE at 0.75 on the gamma bars, white
 * at 0.6 on the delta and call/put charts.
 */
export const SPOT_LINE = { color: LIGHT_BLUE, dash: '2 3', opacity: 0.6 } as const

/**
 * THE GAMMA FLIP MARKER — one treatment. v2 had three: white "2 3" at 0.55 on
 * the cumulative chart, green "4 3" at 0.55 on the gamma bars, white "2 2" at
 * 0.45 in the table sparkline. This is v2's majority treatment. `VIOLET`, v3's
 * dedicated flip token, was the other candidate and is deliberately not taken —
 * it would put a hue on this tab that v2 never painted here.
 */
export const FLIP_LINE = { color: T.text, dash: '2 3', opacity: 0.55 } as const

/**
 * IN-VIEW RULE FOR THE FLIP LINE. v2 disagreed with itself: the gamma bars and
 * the table sparkline draw it only when it falls inside the visible domain,
 * while the cumulative chart draws it whenever it is finite — clamping or
 * extrapolating an off-window flip onto the edge of the plot. This exports the
 * in-view test so step 3 applies ONE rule; the cumulative chart's unguarded
 * version is the odd one out, not the intent.
 */
export function flipInView(neutral: number | null | undefined, lo: number, hi: number): boolean {
  return neutral != null && Number.isFinite(neutral) && neutral >= lo && neutral <= hi
}

/** A gauge band, in raw value units. */
export interface GaugeBand {
  from: number
  to: number
  color: string
}

/**
 * The $Gamma gauge auto-ranges: a floor of 500M, otherwise 1.4× the reading, so
 * the needle can never exceed ~71% of a half and never pins.
 */
export const GAMMA_GAUGE_FLOOR = 500_000_000
export const GAMMA_GAUGE_HEADROOM = 1.4

export function gammaGaugeSpan(dollarGamma: number | null | undefined): number {
  return Math.max(GAMMA_GAUGE_FLOOR, Math.abs(dollarGamma ?? 0) * GAMMA_GAUGE_HEADROOM)
}

/**
 * Two bands, boundary at exactly 0.
 * v2: negative HOME_THEME.red, positive LIGHT_BLUE. Positive is a SIGN → MOVE_UP.
 */
export function gammaGaugeBands(span: number): GaugeBand[] {
  return [
    { from: -span, to: 0, color: MOVE_DOWN },
    { from: 0, to: span, color: MOVE_UP },
  ]
}

/** The CPG gauge is a FIXED 0–2 scale; a ratio above 2 clamps and pins hard right. */
export const CPG_GAUGE_MIN = 0
export const CPG_GAUGE_MAX = 2

/**
 * Three bands, in order: [0,0.7) alarming · [0.7,1.3) balanced · [1.3,2] alarming.
 *
 * The middle band is BALANCED, not positive — so it keeps the accent rather
 * than collapsing onto MOVE_UP. Both extremes were HOME_THEME.red in v2, which
 * means the colour alone cannot tell call-heavy from put-heavy; that is v2's
 * design and it is preserved.
 */
export function cpgGaugeBands(): GaugeBand[] {
  return [
    { from: 0, to: 0.7, color: MOVE_DOWN },
    { from: 0.7, to: 1.3, color: LIGHT_BLUE },
    { from: 1.3, to: CPG_GAUGE_MAX, color: MOVE_DOWN },
  ]
}

/** Gauge geometry, in SVG user units. `needleFrac` is the needle's share of `r`. */
export const GAUGE_GEOM = { w: 200, h: 118, cx: 100, cy: 100, r: 78, needleFrac: 0.82 } as const

/** Value → needle angle. Left edge is `min`, right edge is `max`. */
export function gaugeAngle(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value))
  const frac = (clamped - min) / (max - min || 1)
  return Math.PI - frac * Math.PI
}

/** The header tiles' accents (B43, B44, B46, B48). */
export const TILE_ACCENT = {
  stockPrice: T.text,
  /** v2 LIGHT_BLUE — a wall level, an accent, not a sign. Stays the accent. */
  resistance: LIGHT_BLUE,
  /** v2 HOME_THEME.red. */
  support: MOVE_DOWN,
  neutral: T.text,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// § 10 — THE REFRESH BUTTON LADDER (B59)
// ─────────────────────────────────────────────────────────────────────────────

export type RefreshState = 'idle' | 'refreshing' | 'success' | 'error'

/**
 * The header card's refresh label, by state. Glyphs are U+21BB, U+2713, U+2717
 * and a single U+2026.
 */
export const REFRESH_LABEL: Record<RefreshState, string> = {
  idle: '↻ Now',
  refreshing: '↻ Refreshing…',
  success: '✓ Refreshed',
  error: '✗ Failed',
}

/**
 * The lock is released this long AFTER the request settles, so a second click
 * is a no-op for the whole request plus 1800ms.
 *
 * v2 never cleared this timer on unmount, so switching tabs mid-refresh fired a
 * setState on an unmounted component. Step 3 must clear it — the value is the
 * transcription, the leak is not.
 */
export const REFRESH_LOCK_MS = 1800

/** `success` on any resolve, `error` on any throw. Both revert after the lock. */
export function refreshInk(state: RefreshState): string {
  if (state === 'success') return MOVE_UP // v2 REFRESH_GREEN #1FD98A → the up token
  if (state === 'error') return MOVE_DOWN // v2 HOME_THEME.red
  if (state === 'refreshing') return T.flat // v2 "#888"
  return T.cyan
}

/** The four panel-level buttons (EOD ×2, OI-by-expiration, multi-expiry) and card 12's. */
export const PANEL_REFRESH_LABEL = 'Refresh'

// ─────────────────────────────────────────────────────────────────────────────
// § 11 — HEADER CARD COPY (B30–B38, B45, B47, B49, B60)
// ─────────────────────────────────────────────────────────────────────────────

export const HEADER_COPY = {
  /** `${symbol} · GEX Levels`, with "SPX" as the pre-first-frame fallback. */
  title: (symbol: string | undefined) => `${symbol ?? DEFAULT_SYMBOL} · GEX Levels`,
  /** `${expiry} expiry · spot 6412.35 · as of 03:41:07 PM ET`. */
  subtitle: (expiry: string | undefined, spot: number, asOf: string) =>
    `${expiry ?? '0DTE'} expiry · spot ${fmt2(spot)} · as of ${asOf} ET`,
  subtitleLoading: 'loading live /proxy/gex snapshot…',
  feedError: (msg: string) => `Feed error: ${msg}`,
  waiting: 'waiting on /proxy/gex…',
  stockFilterLabel: 'Stock Filter',
  expiryFilterLabel: 'Expiry Filter',
  /**
   * A sibling of the gated block, so it renders under the waiting state too.
   * v2 wrote the apostrophe as `&apos;`; it is a real U+2019 here.
   */
  footnote:
    "Single shared 0DTE feed — Stock/Expiry filters are read-only displays so this tab can't move the live feed everyone else is on.",
} as const

/** The four header tiles, in render order. */
export const TILE_COPY = {
  stockPrice: 'Stock Price',
  resistance: 'Resistance',
  support: 'Support',
  neutral: 'Neutral',
  /** The scope chip beside three of the four labels. */
  scope0dte: '0DTE',
} as const

/**
 * The three tile tooltips. All three exist because this page grew whole-board
 * and ex-0DTE cards that print their OWN flip and walls — "two different
 * numbers called Neutral and flip on one screen, with no scope on either, reads
 * as a bug rather than as two honest measurements of different things".
 */
export const TILE_TITLE = {
  resistance:
    "Call wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's.",
  support:
    "Put wall on the live feed's single expiry (±8% of spot). The ex-0DTE card lower down has the whole board's.",
  neutral:
    "Gamma flip on the live feed's single expiry. The all-expirations and ex-0DTE cards lower down each report their own — they are not meant to match this one.",
} as const

export const GAUGE_COPY = {
  dollarGamma: '$Gamma',
  cpgRatio: 'CPG Ratio',
} as const

/**
 * The Expiry Filter's option list: the snapshot's expirations if it has any,
 * else the single live expiry. RAW `YYYY-MM-DD` strings, unformatted, in SERVER
 * ORDER — this list is not sorted here, unlike the OI-by-expiration target set.
 * The control is permanently disabled; its placeholder is the live expiry.
 */
export function expiryFilterOptions(snap: GexLevelsSnapshot | null): { value: string; label: string }[] {
  const src = snap?.expirations?.length ? snap.expirations : [snap?.expiry ?? '']
  return src.filter(Boolean).map((e) => ({ value: e, label: e }))
}

// ─────────────────────────────────────────────────────────────────────────────
// § 12 — SHARED PANEL COPY (B61, B62, B101, B118, B126, B127, B139, B178–B181,
//        B216–B222, B256–B260)
// ─────────────────────────────────────────────────────────────────────────────

export const EMPTY_COPY = {
  /** Cards 1 and 4 share this exact string. */
  historyLogging: 'Logging starts as soon as a level moves.',
  noChainRows: 'no chain rows',
  noExpirations: 'no expirations',
  oiLoading: 'loading expirations…',
  oiNoData: 'no data yet',
  eodLoading: 'loading eod_gex…',
  multiLoading: 'sweeping the board…',
  multiNoLadder: 'no ladder available',
  multiNoStrikes: 'no strikes returned',
  /**
   * A stale server-v2 ships the multi rows with both delta legs zeroed. Say so
   * instead of drawing a convincing flat line.
   */
  multiDeltaAllZero:
    'net delta is zero at every strike — server-v2 is likely running a build before /proxy/gex-by-strike-multi shipped netDEX; redeploy it',
} as const

export const ERROR_COPY = {
  eod: (msg: string) => `EOD GEX error: ${msg}`,
  oiExpiry: (msg: string) => `OI-by-expiration error: ${msg}`,
  /** The gamma panels' wording… */
  multiGamma: (msg: string) => `Multi-expiry GEX error: ${msg}`,
  /** …and the delta panel's, for the SAME error from the SAME shared load. */
  multiDelta: (msg: string) => `Multi-expiry DEX error: ${msg}`,
} as const

export const STATUS_COPY = {
  loading: 'Loading…',
  none: EM_DASH,
  /** Card 5's status line. */
  oiLoaded: (etHm: string) => `Loaded ${etHm} ET · once/day (OPRA OI)`,
} as const

/** The three-way empty ternary both multi panels use, in this precedence. */
export function multiEmptyNote(loading: boolean, err: string | null): string {
  return loading ? EMPTY_COPY.multiLoading : err ? EMPTY_COPY.multiNoLadder : EMPTY_COPY.multiNoStrikes
}

export const LEGEND_COPY = {
  positiveGamma: 'Positive gamma$',
  negativeGamma: 'Negative gamma$',
  positiveDelta: 'Positive delta$',
  negativeDelta: 'Negative delta$',
  /** Card 10's legend uses the bare words, without the `delta$` suffix. */
  positive: 'Positive',
  negative: 'Negative',
  spot: 'Spot',
  flip: 'Flip',
  callGex: 'CallGEX',
  putGex: 'PutGEX',
} as const

export interface LegendItem {
  label: string
  color: string
}

/** Card 6 — cumulative 0DTE gamma. */
export const LEGEND_NET_GAMMA: readonly LegendItem[] = [
  { label: LEGEND_COPY.positiveGamma, color: MOVE_UP },
  { label: LEGEND_COPY.negativeGamma, color: MOVE_DOWN },
  { label: LEGEND_COPY.spot, color: SPOT_LINE.color },
]

/**
 * Cards 7 & 8 — multi-expiry gamma bars. Four items.
 *
 * In v2 "Positive gamma$" and "Flip" carried the SAME swatch (#22C55E), so the
 * legend could not distinguish them. Under the collapse the flip line takes
 * `FLIP_LINE.color` and the two swatches now differ, which is the point of
 * having a legend at all.
 */
export const LEGEND_NET_GAMMA_MULTI: readonly LegendItem[] = [
  { label: LEGEND_COPY.positiveGamma, color: MOVE_UP },
  { label: LEGEND_COPY.negativeGamma, color: MOVE_DOWN },
  { label: LEGEND_COPY.spot, color: SPOT_LINE.color },
  { label: LEGEND_COPY.flip, color: FLIP_LINE.color },
]

/** Card 9 — call/put gamma. */
export const LEGEND_CALL_PUT: readonly LegendItem[] = [
  { label: LEGEND_COPY.callGex, color: CALL_LEG_COLOR },
  { label: LEGEND_COPY.putGex, color: PUT_LEG_COLOR },
]

/** Card 10 — 0DTE net delta. */
export const LEGEND_NET_DELTA: readonly LegendItem[] = [
  { label: LEGEND_COPY.positive, color: MOVE_UP },
  { label: LEGEND_COPY.negative, color: MOVE_DOWN },
]

/**
 * Card 11 — ex-0DTE net delta. Its Spot swatch was the only white one on the
 * tab, matching that chart's white spot line; both collapse onto `SPOT_LINE`.
 */
export const LEGEND_NET_DELTA_MULTI: readonly LegendItem[] = [
  { label: LEGEND_COPY.positiveDelta, color: MOVE_UP },
  { label: LEGEND_COPY.negativeDelta, color: MOVE_DOWN },
  { label: LEGEND_COPY.spot, color: SPOT_LINE.color },
]

/** Cards 2 & 3 — EOD GEX. Both entries name the basis. */
export function eodLegend(field: EodGexField): LegendItem[] {
  const label = EOD_GEX_FIELD_META[field].label
  return [
    { label: `Positive · ${label}`, color: MOVE_UP },
    { label: `Negative · ${label}`, color: MOVE_DOWN },
  ]
}

/** Card 5's two mini charts. */
export const OI_EXPIRY_CHART_COPY = {
  call: { label: 'Call', valueKey: 'callOI', color: CALL_LEG_COLOR },
  put: { label: 'Put', valueKey: 'putOI', color: PUT_LEG_COLOR },
} as const

export const TOOLTIP_COPY = {
  strike: (k: number) => `Strike ${fmt2(k)}`,
  cumulativeGamma: (cum: number) => `Cumulative Gamma$: ${fmtBn(cum)}`,
  netGamma: (v: number) => `Net gamma$: ${fmtBn(v)}`,
  netDelta: (v: number) => `Net Delta: ${fmt0(v)}`,
  /** Rendered ONLY on the "oivol" basis, i.e. only on card 11. */
  netDeltaLegs: (oi: number, vol: number) => `OI ${fmt0(oi)} · Vol ${fmt0(vol)}`,
  callGex: (v: number | null | undefined) => `CallGEX: ${fmtBn(v)}`,
  putGex: (v: number | null | undefined) => `PutGEX: ${fmtBn(v)}`,
  totalOi: (v: number) => `Total OI: ${fmt0(v)}`,
  legOi: (label: string, v: number) => `${label} OI: ${fmt0(v)}`,
  spxClose: (v: number) => `SPX close: ${fmt2(v)}`,
  eodValue: (field: EodGexField, v: number) => `${EOD_GEX_FIELD_META[field].label}: ${fmtBn(v)}`,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// § 13 — CARDS 2 & 3: EOD GEX (B109–B136)
// ─────────────────────────────────────────────────────────────────────────────

export const EOD_GEX_SYMBOL = '$SPX'
export const EOD_GEX_DAYS = 30

/**
 * Per-basis labelling for chart, tooltip, legend and empty state, so adding a
 * basis does not mean threading another boolean through three components.
 *
 * The third v2 member, `totalGex`, is gone — see the REMOVED block at the top.
 */
export const EOD_GEX_FIELD_META: Record<EodGexField, { label: string; empty: string; note: string }> = {
  totalGex0dte: {
    label: 'Net GEX (0DTE, OI+Vol)',
    empty: 'no 0DTE OI+Vol rows yet — run scripts/backfill-eod-gex-0dte.js',
    note: 'eod_gex.total_gex_0dte, OI+Vol',
  },
  totalGexEx0dte: {
    label: 'Net GEX (ex-0DTE, OI+Vol)',
    empty: 'no ex-0DTE data yet',
    note: 'eod_gex.total_gex_ex0dte, OI+Vol',
  },
}

/** Sessions plottable on THIS basis. A null is dropped, never plotted as zero. */
export function eodPlottable(rows: EodGexRow[], field: EodGexField): EodGexRow[] {
  return rows.filter((r) => Number.isFinite(r[field]))
}

/**
 * The status line, with the dropped-session disclosure appended when any
 * session has no value on this basis. Boundary is `> 0`.
 */
export function eodStatusLine(
  rows: EodGexRow[],
  field: EodGexField,
  loading: boolean,
  loadedAt: number | null,
): string {
  if (loading) return STATUS_COPY.loading
  if (loadedAt == null) return STATUS_COPY.none
  const plottable = eodPlottable(rows, field).length
  const dropped = rows.length - plottable
  const base = `Loaded ${etHourMinute(loadedAt)} ET · ${plottable} session${plottable === 1 ? '' : 's'} (${EOD_GEX_FIELD_META[field].note})`
  return dropped > 0 ? `${base} · ${dropped} without this basis, not shown` : base
}

// ─────────────────────────────────────────────────────────────────────────────
// § 14 — CARDS 7, 8 & 11: THE MULTI-EXPIRY LADDERS (B210–B222, B256, B257)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server-side cached ~60s — the sweep is one upstream fetch per expiration — so
 * this polls at 60s rather than riding the 15s /proxy/gex loop.
 */
export const GEX_MULTI_POLL_MS = 60_000

/** `${n} expirations` — card 7's scope note, straight from the payload. */
export function scopeNoteAll(expiryCount: number | undefined): string {
  return `${expiryCount ?? 0} expirations`
}

/**
 * Cards 8 and 11's scope note. The count is DERIVED by subtracting one and
 * flooring at zero — the server does not report an ex-0DTE count.
 */
export function scopeNoteEx0dte(expiryCount: number | undefined): string {
  return `${Math.max(0, (expiryCount ?? 0) - 1)} expirations, 0DTE excluded`
}

/**
 * The gamma panels' header line: scope · total · flip · walls.
 *
 * The WALLS CLAUSE is dropped entirely — not printed as an em dash — when the
 * ladder carries neither wall, "so a stale deploy reads as 'this build has no
 * walls' instead of 'there are no walls'". These are THIS ladder's own walls,
 * never /proxy/gex's, which are 0DTE and clipped to ±8% of spot.
 */
export function multiStatusLine(ladder: GexMultiLadder | null, loading: boolean, scopeNote: string): string {
  if (loading && !ladder) return STATUS_COPY.loading
  if (!ladder) return STATUS_COPY.none
  const walls =
    ladder.callWall != null || ladder.putWall != null
      ? `res ${ladder.callWall != null ? fmt0(ladder.callWall) : EM_DASH} · sup ${ladder.putWall != null ? fmt0(ladder.putWall) : EM_DASH}`
      : null
  return [
    scopeNote,
    `total ${fmtBn(ladder.totalNetGex)}`,
    `flip ${ladder.gexFlip != null ? fmt0(ladder.gexFlip) : EM_DASH}`,
    walls,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Card 11's header line. The total is summed CLIENT-SIDE on purpose: the
 * payload's `totalNetGex` is a GAMMA total and there is no server-side delta
 * total to borrow. Summing the ladder being drawn keeps number and bars in
 * lockstep.
 */
export function multiDeltaTotal(ladder: GexMultiLadder | null): number {
  return (ladder?.rows ?? []).reduce((a, r) => a + dexOf(r, 'oivol'), 0)
}

export function multiDeltaStatusLine(
  ladder: GexMultiLadder | null,
  loading: boolean,
  scopeNote: string,
): string {
  if (loading && !ladder) return STATUS_COPY.loading
  if (!ladder) return STATUS_COPY.none
  return `${scopeNote} · total ${fmtBn(multiDeltaTotal(ladder))}`
}

/** True when every strike's OI+Vol delta is exactly zero — see `multiDeltaAllZero`. */
export function multiDeltaAllZero(ladder: GexMultiLadder | null): boolean {
  return !!ladder?.rows.length && ladder.rows.every((r) => dexOf(r, 'oivol') === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 15 — CARD 5: OI BY EXPIRATION (B169–B189)
// ─────────────────────────────────────────────────────────────────────────────

export const OI_EXPIRY_MAX = 12
export const OI_EXPIRY_CACHE_PREFIX = 'gexlevels-oi-by-expiry-v1'

/**
 * Which expirations to ask for: a LEXICOGRAPHIC sort of the `YYYY-MM-DD`
 * strings — which is also chronological for that format — then the nearest 12.
 *
 * Takes the list as an argument. It never reaches for a snapshot itself; that
 * is what lets the route fire this without waiting on a render. See the
 * departure note in gexLevelsData.ts.
 */
export function oiExpiryTargets(expirations: string[]): string[] {
  return expirations.slice().sort().slice(0, OI_EXPIRY_MAX)
}

/** Per-symbol, per-ET-day. Valid only when both the date and the symbol match. */
export function loadOiExpiryCache(symbol: string): OiExpiryCache | null {
  try {
    const raw = localStorage.getItem(`${OI_EXPIRY_CACHE_PREFIX}:${symbol}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OiExpiryCache | null
    return parsed?.date && parsed?.symbol === symbol ? parsed : null
  } catch {
    return null
  }
}

export function saveOiExpiryCache(symbol: string, rows: OiByExpiryRow[]): void {
  try {
    const entry: OiExpiryCache = { date: todayEtDate(), symbol, rows }
    localStorage.setItem(`${OI_EXPIRY_CACHE_PREFIX}:${symbol}`, JSON.stringify(entry))
  } catch {
    // localStorage unavailable — just won't cache, and it refetches every mount.
  }
}

/** Today's cache, or null. The day check is why OPRA's once-daily OI is cheap. */
export function readFreshOiExpiryCache(symbol: string): OiExpiryCache | null {
  const cached = loadOiExpiryCache(symbol)
  return cached && cached.date === todayEtDate() ? cached : null
}

/**
 * Sum call and put OI out of one /api/chains body.
 *
 * A group whose `expiration-date` is present AND different is skipped — an
 * EMPTY `expiration-date` is therefore counted, which is v2's behaviour and
 * matters when the upstream omits the field.
 */
export function sumChainOi(json: unknown, expiry: string): { callOI: number; putOI: number } {
  const body = json as { data?: { items?: unknown[] } } | null
  const items: unknown[] = Array.isArray(body?.data?.items) ? body.data.items : []
  let callOI = 0
  let putOI = 0
  const oi = (o: Record<string, unknown> | undefined): number =>
    o ? parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0 : 0
  for (const group of items) {
    const g = group as { 'expiration-date'?: string; strikes?: unknown[] }
    const groupExp = String(g['expiration-date'] ?? '').slice(0, 10)
    if (groupExp && groupExp !== expiry.slice(0, 10)) continue
    for (const item of g.strikes ?? []) {
      const it = item as { call?: Record<string, unknown>; put?: Record<string, unknown> }
      callOI += oi(it.call)
      putOI += oi(it.put)
    }
  }
  return { callOI, putOI }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 16 — CARD 4: THE DAILY KEY-LEVEL LOG (B137–B168)
// ─────────────────────────────────────────────────────────────────────────────

export const HISTORY_STORAGE_KEY = 'gexlevels-daily-history-v1'
/** The WRITE cap only. React state is not truncated — server rows past day 60 still render. */
export const HISTORY_MAX_DAYS = 60
/** The server keeps this table forever; ten years of sessions is the practical ceiling. */
export const HISTORY_FETCH_LIMIT = 3650

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : []
  } catch {
    return []
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX_DAYS)))
  } catch {
    // Quota or private mode — history just won't persist.
  }
}

/**
 * Merge server rows with the localStorage cache, keyed by date. The freshest
 * `t` wins per date — today's local row updates on the 15s feed against the
 * server's 5m upsert.
 *
 * A local row that wins keeps `curve: e.curve ?? cur?.curve ?? null`, so a
 * pre-curve local row cannot delete a curve the server already has.
 *
 * Result is sorted date DESC.
 */
export function mergeHistory(server: HistoryEntry[], local: HistoryEntry[]): HistoryEntry[] {
  const byDate = new Map<string, HistoryEntry>()
  for (const e of server) byDate.set(e.date, e)
  for (const e of local) {
    const cur = byDate.get(e.date)
    if (!cur || (e.t ?? 0) > (cur.t ?? 0)) {
      byDate.set(e.date, { ...e, curve: e.curve ?? cur?.curve ?? null })
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** Today's row, built from the live derivation. */
export function buildTodayHistoryRow(d: GexLevelsDerived, now = Date.now()): HistoryEntry {
  return {
    date: todayEtDate(),
    t: now,
    spot: d.spot,
    resistance: d.resistance,
    support: d.support,
    neutral: d.neutral,
    dollarGamma: d.dollarGamma,
    cpgRatio: d.cpgRatio,
    r2: d.r2,
    s2: d.s2,
    openInt: openInterestTotal(d),
    curve: downsampleCurve(cumulativeByStrike(d.rows)),
  }
}

/** A $Gamma move counts only in whole millions. */
export const HISTORY_DOLLAR_GAMMA_STEP = 1e6
/** A CPG move counts only above 0.02, STRICTLY. */
export const HISTORY_CPG_STEP = 0.02

/**
 * THE REWRITE TEST — five fields only. See header note 5: `spot`, `r2`, `s2`,
 * `openInt` and `curve` are written by `buildTodayHistoryRow` but are NOT
 * compared, so those cells go stale until one of these five moves. Spec open
 * question 4 asks whether they should join the test or the row should rewrite
 * on a timer; this reproduces v2 exactly and decides nothing.
 */
export function historyRowChanged(existing: HistoryEntry, entry: HistoryEntry): boolean {
  return (
    existing.resistance !== entry.resistance ||
    existing.support !== entry.support ||
    existing.neutral !== entry.neutral ||
    Math.round(existing.dollarGamma / HISTORY_DOLLAR_GAMMA_STEP) !==
      Math.round(entry.dollarGamma / HISTORY_DOLLAR_GAMMA_STEP) ||
    Math.abs(existing.cpgRatio - entry.cpgRatio) > HISTORY_CPG_STEP
  )
}

/**
 * Apply today's row to the log: prepend on a new trading day, rewrite in place
 * when the five-field test passes, otherwise return the SAME array so nothing
 * re-renders. Prior days are never touched once their date has passed.
 */
export function applyTodayHistoryRow(prev: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const idx = prev.findIndex((e) => e.date === entry.date)
  if (idx === -1) return [entry, ...prev]
  const existing = prev[idx]
  if (!existing || !historyRowChanged(existing, entry)) return prev
  const next = prev.slice()
  next[idx] = entry
  return next
}

/** The 11 columns, in render order. `align` is the cell alignment override. */
export const HISTORY_COLUMNS = [
  { key: 'date', label: 'Date', align: 'left' },
  { key: 'curve', label: 'Curve', align: 'center' },
  { key: 'spot', label: 'Price', align: 'right' },
  { key: 'resistance', label: 'Resistance', align: 'right' },
  { key: 'support', label: 'Support', align: 'right' },
  { key: 'neutral', label: 'Neutral', align: 'right' },
  { key: 'dollarGamma', label: '$Gamma', align: 'right' },
  { key: 'cpgRatio', label: 'CPG', align: 'right' },
  { key: 'r2', label: 'R2', align: 'right' },
  { key: 's2', label: 'S2', align: 'right' },
  { key: 'openInt', label: 'Open Int', align: 'right' },
] as const

/**
 * Every history cell's text. NO column carries a colour rule — a negative
 * $Gamma reads as plain text with a hyphen, and CPG is plain despite the header
 * gauge banding the same value red/blue/red.
 *
 * There is also NO SORT UI: row order is whatever the merge produced (date
 * DESC) with today prepended at index 0.
 */
export function historyCellText(row: HistoryEntry, key: (typeof HISTORY_COLUMNS)[number]['key']): string {
  switch (key) {
    case 'date':
      return fmtDate(row.date)
    case 'curve':
      // The only cell that is not text: a drawable curve renders the sparkline
      // (empty string here, the caller draws it), and anything shorter than two
      // points renders a dimmed em dash instead.
      return row.curve && row.curve.length > 1 ? '' : EM_DASH
    case 'spot':
      return fmt2(row.spot)
    case 'resistance':
      return row.resistance != null ? fmt0(row.resistance) : EM_DASH
    case 'support':
      return row.support != null ? fmt0(row.support) : EM_DASH
    case 'neutral':
      return row.neutral != null ? fmt0(row.neutral) : EM_DASH
    case 'dollarGamma':
      return fmtBn(row.dollarGamma)
    case 'cpgRatio':
      return fmt2(row.cpgRatio)
    case 'r2':
      return row.r2 != null ? fmt0(row.r2) : EM_DASH
    case 's2':
      return row.s2 != null ? fmt0(row.s2) : EM_DASH
    case 'openInt':
      return fmt0(row.openInt)
  }
}

/** On the Curve cell, on every row — including the ones showing an em dash. */
export const HISTORY_CURVE_TITLE =
  "Cumulative gamma$ across all strikes as of this row's last update — dashed line = Neutral (gamma flip)"

/**
 * The sparkline's own domain. Zero is always inside because both extremes are
 * taken against 0; a flat curve gets ±1.
 */
export function curveSparkDomain(pts: CurvePt[]): { xlo: number; xhi: number; lo: number; hi: number } | null {
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (!first || !last) return null
  const vals = pts.map((p) => p.cum)
  const { min, max } = domainWithZero(vals)
  return { xlo: first.strike, xhi: last.strike, lo: min, hi: max }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 17 — CARD 12: NET VOL GEX FLOW (B263–B266, B275–B334)
//
// The panel is SHARED with /home's "Vol GEX Flow" tab. Everything here is the
// panel's own — it takes no props and owns its picker, session switch, view
// switch, fetch and poll.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 30s is the floor the endpoint enforces AND the recorder's write cadence.
 * Going 1:1 with the recorder is only safe because it writes on a fixed 30s
 * grid slot — the same grid the endpoint buckets on — so every bucket holds
 * exactly one row. Under the older drifting throttle this pairing produced "the
 * shark tooth": buckets that caught two writes threw one away, and neighbours
 * that caught none dropped a point entirely.
 */
export const BIN_SEC = 30

/** Buckets are sub-minute, so `BIN_SEC / 60` would render "0.5m". */
export const BIN_LABEL = BIN_SEC < 60 ? `${BIN_SEC}s` : `${BIN_SEC / 60}m`

/** Half the bucket width, so a new bucket is on screen within one poll. */
export const VOL_FLOW_POLL_MS = 15_000

/**
 * Sentinel picks. Real picks are ISO expiry strings, which can never collide
 * with these because neither parses as a date.
 */
export const VOL_FLOW_FRONT = '__front__'
export const VOL_FLOW_ALL = '__all__'

/**
 * RTH is the default because the overnight stretch has no new prints — values
 * persist until the chain resets, which draws a long flat line and a phantom
 * step that read as signal but aren't.
 */
export const VOL_FLOW_DEFAULT_SESSION: VolFlowSession = 'rth'
export const VOL_FLOW_DEFAULT_PICK = VOL_FLOW_FRONT

/**
 * The view toggle's persistence key.
 *
 * `sessionStorage`, NOT localStorage — per browser tab, cleared when the tab
 * closes. It is the only sessionStorage key in Part B; the card layout and the
 * OI cache both use localStorage, with no stated reason for the split (spec
 * "Do not port" 26).
 */
export const PCT_VIEW_STORAGE_KEY = 'cbedge.volGexFlow.pctView'

/** Default OFF, so the panel still opens on the dollar series it always showed. */
export function readPctView(): boolean {
  try {
    return sessionStorage.getItem(PCT_VIEW_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** `prev` is the value BEFORE the toggle — v2 writes inside the state updater. */
export function writePctView(prev: boolean): void {
  try {
    sessionStorage.setItem(PCT_VIEW_STORAGE_KEY, prev ? '0' : '1')
  } catch {
    // sessionStorage unavailable — the view just won't be remembered.
  }
}

/** The % series splits here, not at zero: 50% is a balanced chain. */
export const VOL_FLOW_PCT_BASELINE = 50

/** Only buckets that actually carry a positive share. */
export function pctPointsOf(points: VolFlowPoint[]): VolFlowPoint[] {
  return points.filter((p) => p.posPct != null && Number.isFinite(p.posPct))
}

export const VOL_FLOW_COPY = {
  titleDollar: 'Net Vol GEX Flow',
  titlePct: '+GEX % of Chain',
  /** "30s buckets · today ET". */
  bucketNote: `${BIN_LABEL} buckets · today ET`,
  refresh: PANEL_REFRESH_LABEL,
  expiryAriaLabel: 'Expiration',
  sessionRth: 'RTH',
  sessionEth: 'ETH',
  sessionRthTitle: 'Regular hours — 09:30–16:00 ET',
  sessionEthTitle: 'Extended — the whole ET day, including the overnight tail',
  viewDollar: '$ GEX',
  viewPct: '+GEX %',
  viewDollarTitle: 'Net vol GEX in dollars — the signed flow series',
  viewPctTitle:
    "Share of the selected expiry's |net GEX| (OI+Vol) that is positive — the same number as the home Levels strip's +GEX % tile. Above 50% = long-gamma chain.",
  longGamma: 'LONG GAMMA',
  shortGamma: 'SHORT GAMMA',
  frontOnly: 'Front',
  allExpiries: 'All expiries',
  errNoDb: 'History DB unavailable',
  errFeed: 'Feed unavailable',
  loadingDollar: 'Loading net vol GEX history…',
  loadingPct: 'Loading +GEX % history…',
  emptyRth: "No snapshots in today's RTH window — try ETH",
  emptyEth: 'No snapshots recorded yet today',
} as const

/** The two session buttons, in order. */
export const VOL_FLOW_SESSIONS = [
  { id: 'rth', label: VOL_FLOW_COPY.sessionRth, title: VOL_FLOW_COPY.sessionRthTitle },
  { id: 'eth', label: VOL_FLOW_COPY.sessionEth, title: VOL_FLOW_COPY.sessionEthTitle },
] as const satisfies readonly { id: VolFlowSession; label: string; title: string }[]

/**
 * The two view buttons, in order. ALWAYS rendered: an earlier version hid the
 * control whenever the window held no posPct rows, so the whole feature
 * vanished on a weekend and read as the change having been rolled back.
 */
export const VOL_FLOW_VIEWS = [
  { pct: false, label: VOL_FLOW_COPY.viewDollar, title: VOL_FLOW_COPY.viewDollarTitle },
  { pct: true, label: VOL_FLOW_COPY.viewPct, title: VOL_FLOW_COPY.viewPctTitle },
] as const

/**
 * Picker options: the two sentinels, then one row per reported expiry in the
 * SERVER's order — not sorted client-side. The list is whatever the endpoint
 * reports as actually having rows today, so a pick can never produce an empty
 * chart.
 */
export function volFlowExpiryOptions(
  expiries: ExpiryInfo[],
  resolvedExpiry: string | null,
): { value: string; label: string }[] {
  const opts = [
    {
      value: VOL_FLOW_FRONT,
      label: resolvedExpiry ? `${VOL_FLOW_COPY.frontOnly} · ${shortExpiry(resolvedExpiry)}` : VOL_FLOW_COPY.frontOnly,
    },
    { value: VOL_FLOW_ALL, label: VOL_FLOW_COPY.allExpiries },
  ]
  for (const e of expiries) {
    opts.push({ value: e.expiry, label: `${shortExpiry(e.expiry)} · ${e.rows.toLocaleString()} rows` })
  }
  return opts
}

export interface VolFlowStats {
  last: VolFlowPoint
  high: { v: number; at: number }
  low: { v: number; at: number }
  flips: number
}

/**
 * The $ view's stats.
 *
 * Both extremes use a STRICT comparison in the reduce, so the FIRST extreme
 * wins a tie. `flips` counts zero crossings with zero on the POSITIVE side —
 * each one is a regime change between dampening and amplifying.
 */
export function computeVolFlowStats(points: VolFlowPoint[]): VolFlowStats | null {
  if (!points.length) return null
  const vals = points.map((p) => p.volGex)
  const last = points[points.length - 1]
  if (!last) return null
  let hiIdx = 0
  let loIdx = 0
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i] as number
    if (v > (vals[hiIdx] as number)) hiIdx = i
    if (v < (vals[loIdx] as number)) loIdx = i
  }
  let flips = 0
  for (let i = 1; i < vals.length; i++) {
    const prev = vals[i - 1] as number
    const cur = vals[i] as number
    if ((prev < 0 && cur >= 0) || (prev >= 0 && cur < 0)) flips++
  }
  const hi = points[hiIdx]
  const lo = points[loIdx]
  if (!hi || !lo) return null
  return {
    last,
    high: { v: vals[hiIdx] as number, at: hi.ts },
    low: { v: vals[loIdx] as number, at: lo.ts },
    flips,
  }
}

export interface VolFlowPctStats {
  last: { v: number; ts: number; strikes: number }
  d: number | null
  high: { v: number; at: number }
  low: { v: number; at: number }
  abovePct: number
  flips: number
}

/**
 * The % view's stats — kept separate rather than folded into `computeVolFlowStats`
 * because the two views cover DIFFERENT bucket sets: a bucket with rows but no
 * gamma at all has a volGex and no posPct.
 *
 * `flips` counts crossings of 50, not 0 — on this series the regime change is
 * the chain flipping between net long and net short gamma. Same `>= / <`
 * boundary, so exactly 50 is the long side.
 */
export function computeVolFlowPctStats(pctPoints: VolFlowPoint[]): VolFlowPctStats | null {
  if (pctPoints.length === 0) return null
  const vals = pctPoints.map((p) => p.posPct as number)
  const last = pctPoints[pctPoints.length - 1]
  const lastV = vals[vals.length - 1]
  if (!last || lastV == null) return null
  let hiIdx = 0
  let loIdx = 0
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i] as number
    if (v > (vals[hiIdx] as number)) hiIdx = i
    if (v < (vals[loIdx] as number)) loIdx = i
  }
  const above = vals.filter((v) => v >= VOL_FLOW_PCT_BASELINE).length
  let flips = 0
  for (let i = 1; i < vals.length; i++) {
    const prev = vals[i - 1] as number
    const cur = vals[i] as number
    if (
      (prev < VOL_FLOW_PCT_BASELINE && cur >= VOL_FLOW_PCT_BASELINE) ||
      (prev >= VOL_FLOW_PCT_BASELINE && cur < VOL_FLOW_PCT_BASELINE)
    ) {
      flips++
    }
  }
  const prev = vals.length > 1 ? (vals[vals.length - 2] as number) : null
  const hi = pctPoints[hiIdx]
  const lo = pctPoints[loIdx]
  if (!hi || !lo) return null
  return {
    last: { v: lastV, ts: last.ts, strikes: last.strikes },
    d: prev == null ? null : lastV - prev,
    high: { v: vals[hiIdx] as number, at: hi.ts },
    low: { v: vals[loIdx] as number, at: lo.ts },
    abovePct: (above / vals.length) * 100,
    flips,
  }
}

/** `>= 50` is the long-gamma side. v2's POS/NEG were #8ECAE6 / #EF4444. */
export function pctInk(v: number): string {
  return v >= VOL_FLOW_PCT_BASELINE ? MOVE_UP : MOVE_DOWN
}

export interface VolFlowTile {
  label: string
  value: string
  sub: string
  color: string
}

/** Six placeholder tiles keep the block's height fixed so the chart never moves. */
export const VOL_FLOW_TILE_COUNT = 6
export const VOL_FLOW_TILE_PLACEHOLDER: VolFlowTile = { label: EM_DASH, value: EM_DASH, sub: '', color: T.text }

/**
 * The $ view's six tiles, in the fixed order of meaning
 * (now / change / high / low / regime / context) the % view mirrors, "so the
 * eye doesn't have to re-learn the block when you flip the switch".
 *
 * Two asymmetries are v2's and are preserved:
 *   • Session High is inked positive UNCONDITIONALLY — a session whose high is
 *     still negative reads as positive.
 *   • Session Low falls back to plain text when it is non-negative; it is the
 *     only tile on the tab with a neutral fallback ink, and High has no
 *     mirroring guard. Spec open question 11.
 */
export function volFlowDollarTiles(stats: VolFlowStats): VolFlowTile[] {
  const last = stats.last
  return [
    {
      label: 'Net Vol GEX',
      value: fmtGex(last.volGex),
      sub: etTimeFromSec(Math.floor(last.ts / 1000)),
      color: last.volGex >= 0 ? MOVE_UP : MOVE_DOWN,
    },
    {
      label: 'Δ Last Bucket',
      // The `+` is added only when STRICTLY positive; a negative takes its
      // U+2212 from fmtGex. At exactly zero this prints "0" inked positive,
      // which is consistent — unlike the % view's version below.
      value: last.dVol == null ? EM_DASH : `${last.dVol > 0 ? '+' : ''}${fmtGex(last.dVol)}`,
      sub: BIN_LABEL,
      color: (last.dVol ?? 0) >= 0 ? MOVE_UP : MOVE_DOWN,
    },
    {
      label: 'Session High',
      value: fmtGex(stats.high.v),
      sub: etTimeFromSec(Math.floor(stats.high.at / 1000)),
      color: MOVE_UP,
    },
    {
      label: 'Session Low',
      value: fmtGex(stats.low.v),
      sub: etTimeFromSec(Math.floor(stats.low.at / 1000)),
      color: stats.low.v < 0 ? MOVE_DOWN : T.text,
    },
    {
      label: 'Sign Flips',
      value: String(stats.flips),
      sub: stats.flips === 0 ? 'one regime' : 'regime changes',
      color: stats.flips > 0 ? T.orange : T.cyan,
    },
    {
      label: 'Spot',
      // A FALSY test, so a genuine spot of 0 prints an em dash.
      value: last.spot ? last.spot.toFixed(2) : EM_DASH,
      sub: `${last.strikes} strikes`,
      color: T.cyan,
    },
  ]
}

/**
 * The % view's six tiles. Note tile 5 carries the flip COUNT in its sub-label
 * where the $ view puts the count in the value and a bare noun in the sub.
 */
export function volFlowPctTiles(s: VolFlowPctStats): VolFlowTile[] {
  return [
    {
      label: '+GEX %',
      value: `${s.last.v.toFixed(0)}%`,
      sub: etTimeFromSec(Math.floor(s.last.ts / 1000)),
      color: pctInk(s.last.v),
    },
    {
      label: 'Δ Last Bucket',
      // BUG (v2): the sign GLYPH and the INK disagree at exactly zero. The label
      // ternary is `> 0` and the colour ternary is `>= 0`, so a delta of exactly
      // zero renders "−0.0pt" — a minus sign — inked positive. Transcribed as
      // v2 writes it; step 3 decides. (VolGexFlowPanel.tsx:441.)
      value: s.d == null ? EM_DASH : `${s.d > 0 ? '+' : '−'}${Math.abs(s.d).toFixed(1)}pt`,
      sub: BIN_LABEL,
      color: (s.d ?? 0) >= 0 ? MOVE_UP : MOVE_DOWN,
    },
    {
      label: 'Session High',
      value: `${s.high.v.toFixed(0)}%`,
      sub: etTimeFromSec(Math.floor(s.high.at / 1000)),
      color: MOVE_UP,
    },
    {
      label: 'Session Low',
      value: `${s.low.v.toFixed(0)}%`,
      sub: etTimeFromSec(Math.floor(s.low.at / 1000)),
      color: MOVE_DOWN,
    },
    {
      label: 'Time > 50%',
      value: `${s.abovePct.toFixed(0)}%`,
      sub: s.flips === 0 ? 'one regime' : `${s.flips} regime changes`,
      color: s.abovePct >= VOL_FLOW_PCT_BASELINE ? MOVE_UP : MOVE_DOWN,
    },
    {
      label: 'Regime',
      // γ is U+03B3.
      value: s.last.v >= VOL_FLOW_PCT_BASELINE ? 'LONG γ' : 'SHORT γ',
      sub: `${s.last.strikes} strikes`,
      color: pctInk(s.last.v),
    },
  ]
}

/**
 * The scrim's text, in precedence order: error, then loading, then the two
 * empty states. Branch 3 is the only empty state on the tab that names its own
 * remedy.
 */
export function volFlowScrimText(
  err: string | null,
  loading: boolean,
  pctView: boolean,
  session: VolFlowSession,
): string {
  if (err) return err
  if (loading) return pctView ? VOL_FLOW_COPY.loadingPct : VOL_FLOW_COPY.loadingDollar
  return session === 'rth' ? VOL_FLOW_COPY.emptyRth : VOL_FLOW_COPY.emptyEth
}

/** The scrim shows while loading, on an error, or on an empty settled window. */
export function volFlowScrimVisible(loading: boolean, err: string | null, pointCount: number): boolean {
  return loading || !!err || (pointCount === 0 && !loading)
}

/** The scrim's ink: red on an error, the accent otherwise. */
export function volFlowScrimInk(err: string | null): string {
  return err ? MOVE_DOWN : T.cyan
}

// ── Card 12's chart, as configuration ────────────────────────────────────────
// The chart itself is imperative (lightweight-charts) and step 3 mounts it
// through ChartFrame. Everything that is a VALUE rather than a call lives here.
//
// These resolve tokens to hex at CALL TIME, which is why they are functions:
// a canvas cannot take `var(--color-…)` or a `color-mix()`, and a hex typed
// into a chart file is exactly what the token bridge exists to prevent. Call
// them at MOUNT, not per frame.

const TOKEN = {
  up: '--color-move-up',
  down: '--color-move-down',
  fg: '--color-fg',
  line: '--color-line',
} as const

/** v2's grid wash was white at 5%; its borders were white at 10%. */
export function volFlowChartOptions(): {
  backgroundColor: string
  textColor: string
  gridColor: string
  borderColor: string
  attributionLogo: false
  handleScale: false
  handleScroll: false
  crosshairMode: 0
  timeVisible: true
  secondsVisible: false
} {
  return {
    backgroundColor: 'transparent',
    textColor: tokenHex(TOKEN.fg),
    gridColor: tokenHexAlpha(TOKEN.fg, 0.05),
    borderColor: tokenHexAlpha(TOKEN.fg, 0.1),
    attributionLogo: false,
    // No pan, no zoom — the opposite of the four strike charts on this same
    // tab, which implement bespoke wheel-zoom and drag-pan. Spec "Do not port"
    // 29 asks for one model; this transcribes what card 12 does today.
    handleScale: false,
    handleScroll: false,
    crosshairMode: 0,
    timeVisible: true,
    secondsVisible: false,
  }
}

/**
 * Both Baseline series take the same six colours; only the split differs.
 *
 * A Baseline series is used because net vol GEX is a POLARITY measure — the
 * sign IS the signal — and a baseline series splits the fill at zero natively,
 * so the sign is read from colour and side without a legend lookup.
 *
 * v2's fills were hand-typed rgba expansions of #8ECAE6 and #EF4444; here they
 * are the up/down tokens at the same four alphas.
 */
export function volFlowSeriesColors(): {
  topLineColor: string
  topFillColor1: string
  topFillColor2: string
  bottomLineColor: string
  bottomFillColor1: string
  bottomFillColor2: string
} {
  return {
    topLineColor: tokenHex(TOKEN.up),
    topFillColor1: tokenHexAlpha(TOKEN.up, 0.32),
    topFillColor2: tokenHexAlpha(TOKEN.up, 0.02),
    bottomLineColor: tokenHex(TOKEN.down),
    bottomFillColor1: tokenHexAlpha(TOKEN.down, 0.02),
    bottomFillColor2: tokenHexAlpha(TOKEN.down, 0.32),
  }
}

/** Line weight, price line and the two scales' margins — identical on both series. */
export const VOL_FLOW_SERIES_SHAPE = {
  lineWidth: 2,
  priceLineVisible: false,
  /**
   * The bottom margin keeps the lowest price tick off the canvas edge, where
   * lightweight-charts would clip the label in half.
   */
  scaleMargins: { top: 0.12, bottom: 0.14 },
} as const

/**
 * The $ series sits on the RIGHT scale and splits at 0; the % series sits on
 * the LEFT and splits at 50.
 *
 * Two scales rather than one shared: each carries exactly one series, so each
 * keeps its own price formatter ($ vs %) with no fighting over which series
 * formats the axis. Both are declared at construction and only `visible` is
 * toggled — adding a price scale to a live chart re-lays-out the pane and jumps
 * the series.
 */
export const VOL_FLOW_SCALES = {
  dollar: { priceScaleId: 'right', baseValue: 0 },
  pct: { priceScaleId: 'left', baseValue: VOL_FLOW_PCT_BASELINE },
} as const

/** The % axis: whole percent, minMove 0.1. */
export const VOL_FLOW_PCT_MIN_MOVE = 0.1
export function fmtPctAxis(p: number): string {
  return `${p.toFixed(0)}%`
}

/** The $ axis formats with ONE decimal, where the tiles use two. */
export function fmtGexAxis(p: number): string {
  return fmtGex(p, 1)
}

/** Padding either side of the % data, in percentage points. */
export const PCT_AUTOSCALE_PAD = 5

/**
 * THE % AUTOSCALE LADDER. Padded around the data but ALWAYS containing 50, and
 * clamped to 0–100. See header note 10.
 *
 * v2 reads its values from a REF, not state, because the provider is captured
 * once at series creation and would otherwise close over a stale array — step 3
 * must keep that, whatever it stores the values in.
 */
export function pctAutoscaleRange(vals: number[]): { minValue: number; maxValue: number } {
  if (!vals.length) return { minValue: 0, maxValue: 100 }
  const lo = Math.max(0, Math.min(VOL_FLOW_PCT_BASELINE, ...vals) - PCT_AUTOSCALE_PAD)
  const hi = Math.min(100, Math.max(VOL_FLOW_PCT_BASELINE, ...vals) + PCT_AUTOSCALE_PAD)
  return { minValue: lo, maxValue: hi }
}

/** Series data: lightweight-charts wants UNIX SECONDS, the wire carries ms. */
export function volFlowDollarSeries(points: VolFlowPoint[]): { time: number; value: number }[] {
  return points.map((p) => ({ time: Math.floor(p.ts / 1000), value: p.volGex }))
}

export function volFlowPctSeries(pctPoints: VolFlowPoint[]): { time: number; value: number }[] {
  return pctPoints.map((p) => ({ time: Math.floor(p.ts / 1000), value: p.posPct as number }))
}

/**
 * The rAF pump retries sizing while the box has no dimensions, up to this many
 * frames — a chart created inside a flex box that has not laid out yet has a
 * width of 0 and would otherwise never recover.
 */
export const VOL_FLOW_SIZE_PUMP_FRAMES = 120

// ─────────────────────────────────────────────────────────────────────────────
// § 18 — THE 12-CARD REGISTRY (B77–B79, B98–B99, B109–B112, B137–B138, B169–B170,
//        B190–B191, B206–B209, B232–B233, B244–B245, B254–B255, B263–B264)
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_CARD_KEYS = [
  'oiDate',
  'eodGex',
  'eodGexEx0dte',
  'history',
  'oiExpiry',
  'netGamma',
  'netGammaAll',
  'netGammaEx0dte',
  'callPutGamma',
  'netDelta',
  'netDeltaEx0dte',
  'volFlow',
] as const

export type CardKey = (typeof ALL_CARD_KEYS)[number]
export type ColumnId = 'left' | 'right'
export type CardLayout = Record<ColumnId, CardKey[]>

export const COLUMN_IDS: readonly ColumnId[] = ['left', 'right']

/** Which loader feeds a card. Used to fire the right set at route entry. */
export type CardEndpoint =
  | 'proxy/gex'
  | 'proxy/gex-by-strike-multi'
  | 'proxy/gex-levels-history'
  | 'proxy/gex-vol-flow'
  | 'api/eod-gex'
  | 'api/chains'

/** What a title/subtitle builder is allowed to know. */
export interface CardTitleContext {
  symbol: string
  /** The live feed's single expiry, `YYYY-MM-DD`, or undefined before the first frame. */
  expiry: string | undefined
}

export interface GexLevelsCardDef {
  key: CardKey
  title: (ctx: CardTitleContext) => string
  subtitle: (ctx: CardTitleContext) => string
  /** Every endpoint this card's content depends on, most specific first. */
  endpoints: readonly CardEndpoint[]
  /** The column this card lands in for a user with no stored layout. */
  defaultColumn: ColumnId
}

/**
 * The 12 cards, in `ALL_CARD_KEYS` order.
 *
 * Titles are builders because two of them carry the live expiry; the rest
 * ignore their context. Subtitles are the exact v2 strings — they carry the
 * BASIS of each surface, which is the one thing that distinguishes cards 2/3,
 * 6/7/8 and 10/11 from each other, so paraphrasing one makes two cards look
 * like duplicates.
 */
export const GEX_LEVELS_CARDS: readonly GexLevelsCardDef[] = [
  {
    key: 'oiDate',
    title: () => 'Open interest by date',
    subtitle: () =>
      'Total call+put open interest in CONTRACTS (not gamma dollars — no γ, no spot² here), one bar per trading day logged',
    endpoints: ['proxy/gex-levels-history', 'proxy/gex'],
    defaultColumn: 'left',
  },
  {
    key: 'eodGex',
    title: () => 'SPX EOD GEX by session',
    subtitle: () =>
      `0DTE net GEX at the close on the OI+Vol basis — γ × (OI + volume) × spot², the same basis as the walls, the flip and $Gamma · last ${EOD_GEX_DAYS} sessions (eod_gex.total_gex_0dte, ${EOD_GEX_SYMBOL})`,
    endpoints: ['api/eod-gex'],
    defaultColumn: 'left',
  },
  {
    key: 'eodGexEx0dte',
    title: () => 'SPX EOD GEX (ex-0DTE) by session',
    subtitle: () =>
      `Net GEX at the close across all listed expirations except 0DTE, same OI+Vol basis as the card above · add the two for the whole-chain total · last ${EOD_GEX_DAYS} sessions (eod_gex.total_gex_ex0dte, ${EOD_GEX_SYMBOL})`,
    endpoints: ['api/eod-gex'],
    defaultColumn: 'left',
  },
  {
    key: 'history',
    title: () => 'History of key level changes',
    subtitle: () => 'One row per trading day — today updates live, prior days stay frozen',
    endpoints: ['proxy/gex-levels-history', 'proxy/gex'],
    defaultColumn: 'left',
  },
  {
    key: 'oiExpiry',
    title: () => 'Open interest by expiration',
    subtitle: (c) => `${c.symbol} · nearest ${OI_EXPIRY_MAX} listed expirations`,
    endpoints: ['proxy/gex', 'api/chains'],
    defaultColumn: 'right',
  },
  {
    key: 'netGamma',
    title: (c) => `Net gamma exposure by strike (0DTE${c.expiry ? ` · ${fmtExpiryLabel(c.expiry)}` : ''})`,
    subtitle: () =>
      "The live feed's SINGLE expiry. Cumulative across ALL its strikes — green above zero (dealers long gamma), red below (short gamma); crosses zero at the gamma flip (Neutral) · scroll to zoom, drag to pan, double-click to reset",
    endpoints: ['proxy/gex'],
    defaultColumn: 'right',
  },
  {
    key: 'netGammaAll',
    title: () => 'Net gamma exposure by strike (all expirations)',
    subtitle: () =>
      'Every listed expiration combined, 0DTE included — gamma$ per strike, green above zero / red below · OI+Vol basis · scroll to zoom, drag to pan, double-click to reset · refreshed once a minute',
    endpoints: ['proxy/gex-by-strike-multi'],
    defaultColumn: 'right',
  },
  {
    key: 'netGammaEx0dte',
    title: () => 'Net gamma exposure by strike (ex-0DTE)',
    // v2's subtitle omits "double-click to reset" here alone, though the
    // behaviour is identical to card 7's. Copied as written.
    subtitle: () =>
      "Same board with the 0DTE expiry removed — gamma$ per strike, what's left standing after today expires · OI+Vol basis · scroll to zoom, drag to pan · refreshed once a minute",
    endpoints: ['proxy/gex-by-strike-multi'],
    defaultColumn: 'right',
  },
  {
    key: 'callPutGamma',
    title: () => 'Call/put gamma exposure by strike',
    // The shortest subtitle on the tab, and it does not mention scroll-to-zoom
    // even though the wheel handler is attached. v2's, unchanged.
    subtitle: () => 'Click-drag to pan, double-click to reset',
    endpoints: ['proxy/gex'],
    defaultColumn: 'right',
  },
  {
    key: 'netDelta',
    title: (c) => `Net delta exposure by strike (0DTE${c.expiry ? ` · ${fmtExpiryLabel(c.expiry)}` : ''})`,
    subtitle: () =>
      "The live feed's SINGLE expiry — delta$ per strike on the OI leg only · click-drag to pan, double-click to reset",
    endpoints: ['proxy/gex'],
    defaultColumn: 'right',
  },
  {
    key: 'netDeltaEx0dte',
    title: () => 'Net delta exposure by strike (ex-0DTE)',
    subtitle: () =>
      'Every listed expiration EXCEPT 0DTE — delta$ per strike on the OI+Vol basis, so it matches the gamma ladders above rather than the 0DTE delta card · hover a bar to split the two legs · scroll to zoom, drag to pan · refreshed once a minute',
    endpoints: ['proxy/gex-by-strike-multi'],
    defaultColumn: 'right',
  },
  {
    key: 'volFlow',
    title: () => 'Net vol GEX flow (today)',
    // BUG (v2): "5m buckets" is STALE. The panel sends `bin=BIN_SEC` = 30 and
    // prints "30s buckets · today ET" in its own header a few pixels below this
    // line, so the card contradicts itself on screen. The code wins; the string
    // never caught up.
    //
    // Shipped as v2 wrote it, deliberately: reproducing a visibly wrong string
    // is step 3's job, not fixing it. Spec B264 and "Do not port" 24 both want
    // it fixed, and this is the whole edit when Brandon says so — swap the
    // literal for the interpolation the rest of card 12 already uses:
    //   `Intraday path of the volume leg, ${BIN_LABEL} buckets from …`
    subtitle: () =>
      'Intraday path of the volume leg, 5m buckets from option_strike_gex_history · pick an expiration or track the front · above zero = flow adding long gamma (dampening), below = short gamma (amplifying)',
    endpoints: ['proxy/gex-vol-flow'],
    defaultColumn: 'right',
  },
]

/** Look a card up by key. */
export function gexLevelsCard(key: CardKey): GexLevelsCardDef | undefined {
  return GEX_LEVELS_CARDS.find((c) => c.key === key)
}

/**
 * The default arrangement: left is the daily / session-history stack, right is
 * the live-chain stack. Derived from the registry so the two can never drift.
 */
export const DEFAULT_LAYOUT: CardLayout = {
  left: GEX_LEVELS_CARDS.filter((c) => c.defaultColumn === 'left').map((c) => c.key),
  right: GEX_LEVELS_CARDS.filter((c) => c.defaultColumn === 'right').map((c) => c.key),
}

// ─────────────────────────────────────────────────────────────────────────────
// § 19 — LAYOUT PERSISTENCE AND DRAG PLACEMENT (B80–B93, B97)
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_LAYOUT_STORAGE_KEY = 'gexlevels-card-layout-v1'
/** The two pre-cross-column keys, read once to migrate rather than discard. */
export const LEGACY_LEFT_ORDER_KEY = 'gexlevels-card-order-left-v3'
export const LEGACY_RIGHT_ORDER_KEY = 'gexlevels-card-order-right-v3'

export function isCardKey(v: unknown): v is CardKey {
  return typeof v === 'string' && (ALL_CARD_KEYS as readonly string[]).includes(v)
}

/**
 * Three passes: drop values that are not card keys (a card renamed or removed),
 * drop duplicates with FIRST POSITION WINNING, then append every unseen key to
 * the bottom of its DEFAULT column.
 *
 * That last pass is why a NEW card key can be added to the registry without
 * bumping the storage key and resetting everyone's arrangement — it lands at
 * the bottom of its default column for existing users. The guarantee is that
 * all 12 cards render exactly once whatever localStorage holds.
 */
export function normalizeLayout(raw: unknown): CardLayout {
  const src = (raw ?? {}) as Partial<Record<ColumnId, unknown>>
  const out: CardLayout = { left: [], right: [] }
  const seen = new Set<CardKey>()
  for (const col of COLUMN_IDS) {
    const arr = Array.isArray(src[col]) ? (src[col] as unknown[]) : []
    for (const v of arr) {
      if (!isCardKey(v) || seen.has(v)) continue
      seen.add(v)
      out[col].push(v)
    }
  }
  for (const col of COLUMN_IDS) {
    for (const k of DEFAULT_LAYOUT[col]) {
      if (seen.has(k)) continue
      seen.add(k)
      out[col].push(k)
    }
  }
  return out
}

/** v1 key first; the two legacy per-column keys only when v1 is absent. */
export function readStoredLayout(): CardLayout {
  try {
    const raw = localStorage.getItem(CARD_LAYOUT_STORAGE_KEY)
    if (raw) return normalizeLayout(JSON.parse(raw))
    const legacyLeft = localStorage.getItem(LEGACY_LEFT_ORDER_KEY)
    const legacyRight = localStorage.getItem(LEGACY_RIGHT_ORDER_KEY)
    if (legacyLeft || legacyRight) {
      return normalizeLayout({
        left: legacyLeft ? JSON.parse(legacyLeft) : DEFAULT_LAYOUT.left,
        right: legacyRight ? JSON.parse(legacyRight) : DEFAULT_LAYOUT.right,
      })
    }
  } catch {
    // Any parse failure falls through to the default arrangement.
  }
  return normalizeLayout(DEFAULT_LAYOUT)
}

/** Written on every drop and on reset. A write failure is swallowed. */
export function saveLayout(next: CardLayout): void {
  try {
    localStorage.setItem(CARD_LAYOUT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage unavailable — the layout just won't persist.
  }
}

/**
 * Pull the key out of BOTH columns, then splice it into the target at `before`'s
 * index (null = append). ONE code path for a same-column reorder and a
 * cross-column move — v2 used to have two hooks with two key unions, which made
 * a card structurally unable to leave the column it was declared in.
 */
export function placeCard(layout: CardLayout, key: CardKey, col: ColumnId, before: CardKey | null): CardLayout {
  const next: CardLayout = {
    left: layout.left.filter((k) => k !== key),
    right: layout.right.filter((k) => k !== key),
  }
  const idx = before ? next[col].indexOf(before) : -1
  next[col].splice(idx === -1 ? next[col].length : idx, 0, key)
  return next
}

/**
 * Restore and persist the default arrangement.
 *
 * @notWiredInV2 Fully implemented in v2 (`useCardLayout().reset`, :1848–1852),
 * returned by the hook, and connected to NO BUTTON — there is no visible way to
 * reset the layout. It persists correctly; it is simply unreachable. Step 3
 * decides whether it gets a control or goes.
 */
export function resetLayout(): CardLayout {
  const next = normalizeLayout(DEFAULT_LAYOUT)
  saveLayout(next)
  return next
}

/** Just enough of a DataTransfer to read the payload, without a React import. */
export interface DragPayloadReader {
  getData(format: string): string
}

/** The MIME type the drag payload rides on. */
export const DRAG_PAYLOAD_FORMAT = 'text/plain'

/**
 * Prefer the dataTransfer payload over component state: it survives a
 * re-render mid-drag and it is what the browser guarantees is set on drop.
 * Some browsers throw reading dataTransfer outside a drop handler, hence the
 * fallback.
 */
export function draggedKeyFrom(dt: DragPayloadReader | null, fallback: CardKey | null): CardKey | null {
  try {
    const v = dt?.getData(DRAG_PAYLOAD_FORMAT)
    if (isCardKey(v)) return v
  } catch {
    // fall through to the state fallback
  }
  return fallback
}

export const DRAG_COPY = {
  /** U+283F, braille pattern dots-123456. */
  handleGlyph: '⠿',
  handleTitle: 'Drag to move — reorder within a column or drop into the other one',
  /**
   * The tail strip is the append target and the ONLY way into a column that has
   * been emptied out, which is why it is rendered for the whole duration of a
   * drag.
   */
  dropZone: 'Drop here',
} as const
