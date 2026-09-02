// ─────────────────────────────────────────────────────────────────────────────
// GEX CHANGE TOP — WIRE TYPES, THE GRADE LADDER, THE SCORECARD MATHS AND EVERY
// USER-VISIBLE STRING.
//
// Transcribed 1:1 from v2's `components/scanner/GexChangeTop.tsx` (1395 lines)
// against the checklist in docs/parity/scanner.md Part C, rows C1–C158. Nothing
// below was re-derived from the spec table: every boundary, weight, default and
// glyph was copied out of the file while writing.
//
// This is the DEFAULT tab of /scanner, and it is also a cross-part contract:
// Pick Study (Part D) reads this tab's graded pick history back off
// /proxy/gex-change-top-study and asks what the A/B picks had in common at
// capture. Move a boundary in §THE GRADE LADDER below and Part D's calibration
// table silently starts grading a different thing.
//
// Seven pieces of business logic here are NOT obvious from the screen:
//
//   1. THE SERVER COMPUTES, THE CLIENT RENDERS. `row.score`, the ★ Very strong
//      flag, `row.proj_grade` and the shipped `row.grade` / `row.grade_pts` are
//      all produced by server-v2. The local `gradePoints` ladder is a FALLBACK
//      for rows frozen before grading shipped — see `gradeFor`.
//   2. THE SCORECARD IS THE ENTRY BASIS FOR THE CARDS. A card reads its entry,
//      peak, peak time and grade off the scorecard row matched by `watch_id`,
//      never off `watch_options.added_price`, because `added_price` is
//      write-once at a contract's FIRST-EVER probe and a re-flagged strike
//      therefore carries a stale basis from an earlier day. See `derivePickCard`.
//   3. THE HEADLINE IS THE PEAK, NOT "NOW". The card answers "was there a trade
//      in it", not "what would I be holding at 3:55 PM". `now` survives as a
//      demoted line underneath.
//   4. THE $0.50 ENTRY FLOOR is applied to the scorecard AND badged on the cards,
//      with two different comparators that are exact complements: the scorecard
//      keeps `entry > 0.50`, the cheap set takes `entry <= 0.50`.
//   5. THE NEVER-GREEN OVERRIDE (`max_pct <= 0` ⇒ F) is applied on the LOCAL
//      grade path and NOT on the server path. That disagreement is v2's and is
//      preserved — see the `// BUG (v2):` note in `gradeFor`.
//   6. THREE ZERO CONVENTIONS answer one question. A break-even pick paints
//      green in the table, red on the card front and neutral on the card back.
//      Also preserved, also flagged — see §SIGN COLOURS.
//   7. THERE IS NO CLIENT SORT. The scorecard table renders `filteredResults` in
//      array order; the slot sections render `slots` in array order. v2 has no
//      comparator, no default sort column, no direction and no header click
//      handlers on this tab. Row order is whatever the server returned. Do not
//      invent one — a sort would change which pick reads as "the top one".
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// None in the maths. Every threshold, weight, default and comparator below is
// v2's, including the two it gets wrong. The departures in this port are all in
// the data layer (see gexChangeTopData.ts, which straightens C12's waterfall)
// and in the render layer (step 3).
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `tint(hex, a)` (v2 lines 89–92). A local re-implementation of homeTheme's
//   private `themeRgba` that parses "#rrggbb" only — in v3 it is a colour-literal
//   factory. Use `alpha()` / `mix()` from @/design/theme.
// • THE WHOLE html2canvas CAPTURE SURFACE — `⧉ Copy image` (C51), `📷 Screenshot`
//   (C52), the capture filename `gex-change-top-{date|today}.png` (C53), the two
//   per-card `📷` buttons and their busy/"✓ Copied"/"✓ Saved" lifecycle with its
//   1800 ms reset (C109, C110, C127), and the `data-noshot="1"` / `data-flip3d` /
//   `data-face` / `data-card` attribute protocol they depend on.
//
//   WHAT v2's lib/snapshot.ts DID, recorded so nothing here reads as an
//   unexplained deletion. Four exported helpers:
//     · `captureToBlob(el, opts)`  — html2canvas → canvas → PNG blob, retrying
//        once at half scale when `toBlob` returns null on a large card.
//     · `downloadBlob(blob, name)` — object URL + synthetic `<a download>`,
//        revoked after 1 s.
//     · `copyOrDownload(blob, name)` — clipboard write first (as a
//        Promise-valued ClipboardItem, the only form Safari accepts), falling
//        back to `downloadBlob` when the clipboard is unavailable or insecure.
//        Returns which happened, which is what drives "✓ Copied" vs "✓ Saved".
//     · `captureAndCopy(el, name, opts)` — the two above in one call; the
//        per-card 📷 used this.
//   Two clone rules on this tab's markup made the image match the screen:
//     · `[data-flip3d]` (lib/snapshot.ts:477–495) — html2canvas has no 3D
//        pipeline and ignores `backface-visibility`, so a face-down card
//        rasterized as BOTH faces stacked with the back one mirrored. In the
//        clone the flipper's transform/transition/transformStyle/willChange are
//        flattened, the face matching `data-flip3d` is un-hidden, the other is
//        `display:none` (kept in the DOM, so the live↔clone canvas pairing by
//        index still lines up), and any `perspective` is dropped.
//     · `[data-noshot="1"]` (lib/snapshot.ts:1191) — removed from the clone
//        AFTER that pairing. That single line is why the toolbar (C46), the slot
//        headers (C91), the "▸ price line" hint (C123) and the capture buttons
//        themselves are absent from every PNG — and therefore why each card
//        carries its own `capturedLabel` stamp (C116).
//
//   Per docs/parity/em.md Part D, v3 has ONE owner-gated camera in the toolbar
//   (src/shell/CopyShot.tsx) over a dependency-free engine (src/shell/snapshot.ts:
//   clone the subtree, pin computed styles onto it, render through
//   `<svg><foreignObject>`), and it bakes its own title band plus "Data provided
//   by CBEdge.net". This tab publishes its capture target to that menu instead of
//   rolling three cameras and an attribute protocol of its own.
// • The per-card `<img src="/cb-edge-logo.png">` watermark (C124). It existed
//   only so the per-card 📷 had a brand mark in the PNG; the shared framed
//   capture bakes a title band and "Data provided by CBEdge.net" already.
// • `PickChart`'s pixel geometry (C139: W/H/PADL/PADR/PADT/PADB, the 13px chip
//   heights, the 5.4-per-character label width estimate) and the hardcoded
//   `gct-fill` gradient id (C148 — one literal id declared inside a component
//   rendered up to ~65 times). Those are px and DOM identity, which v3's rules
//   put in step 3. The chart's non-px MATHS is here: `pickSeries`, `yDomain`,
//   `Y_TICK_FRACTIONS`, `nearestIndexToTs` and `PEAK_MARKER_MAX_MS`.
// • The `z_score` / `window_min` / `sustained_*` READ-OUTS. There are none —
//   those fields are on the wire and rendered nowhere. They are kept in the
//   types below, tagged, so step 3 can decide; see §FIELDS ON THE WIRE WITH NO
//   SURFACE.
//
// ── WHAT IS NOT IMPORTED FROM @/pages/scanner/format, AND WHY ────────────────
// Only `EM_DASH` is. The others look applicable and are not:
//   • `fmtB` always carries a sign and has a sub-1M branch; this tab's `fmtBig`
//     carries a sign only when negative and has NO sub-1M branch (C17).
//   • `fmtPct` there takes a 0–1 FRACTION at one decimal; this tab's percent
//     fields are already in percent units and print at zero decimals with a `+`
//     prefix (C22). Two different contracts, hence `fmtPctSigned` below.
//   • `fmtInt`, `fmtChg`, `pctOrDash`, `NEUTRAL`, `zColor`, `Z_LEGEND`, `fmtZ`
//     have no consumer on this tab — `z_score` is never rendered here at all.
//
// Spec: docs/parity/scanner.md Part C, rows C1–C158.
// ─────────────────────────────────────────────────────────────────────────────

import { MOVE_DOWN, MOVE_UP, T, V2 } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import { DEFAULT_TAB, scannerTab } from '@/pages/scanner/scannerNav'
import type { ScannerTabId } from '@/pages/scanner/scannerNav'

// ─────────────────────────────────────────────────────────────────────────────
// MOUNT AND ROUTE IDENTITY (C1–C5)
// ─────────────────────────────────────────────────────────────────────────────

/** This tab's registry id. Label, short label, icon and accent live in scannerNav. */
export const TAB_ID: ScannerTabId = 'gexchangetop'

/** C1 — the pill's label / short / icon / accent. Never re-typed here. */
export const TAB_DEF = scannerTab(TAB_ID)

/**
 * C2 / C4 — /scanner's first paint with no `?tab=`, and the tab a non-owner is
 * bounced to when they deep-link an owner-only tab. Both facts are the same
 * fact, and both belong to the Part A page frame; this constant only records
 * that this file is the one they land on.
 *
 * There is NO owner gate on this tab: `GexChangeTop` never called `useIsOwner()`
 * and `SCANNER_TABS` marks only `pickstudy` as `ownerOnly`.
 */
export const IS_DEFAULT_TAB: boolean = DEFAULT_TAB === TAB_ID

// ─────────────────────────────────────────────────────────────────────────────
// WIRE TYPES (C7, C9, C10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One captured pick. `/proxy/gex-change-top → slots[].rows[]`.
 *
 * @see §FIELDS ON THE WIRE WITH NO SURFACE — `z_score` and `window_min` arrive
 * on every row and are rendered nowhere on this tab.
 */
export interface Row {
  slot: string
  rank: number
  symbol: string
  expiry: string
  strike: number
  spot: number | null
  latest_chg: number | null
  pct_open: number | null
  /** @neverReadInV2 On the wire, rendered nowhere on this tab. See C7. */
  z_score: number | null
  score: number | null
  /** @neverReadInV2 On the wire, rendered nowhere on this tab. See C7. */
  window_min: number
  /** `watch_options.id` of the auto-probed contract — null on pre-auto-probe rows. */
  watch_id: number | null
  /**
   * Projected grade STAMPED AT CAPTURE by the recorder's projection rule. Null
   * whenever no rule is armed, which is the shipping default (see
   * server-v2/config/pick-proj-rule.json). Never recomputed client-side: the
   * whole point is that it records what was predicted in advance.
   */
  proj_grade?: string | null
  proj_pts?: number | null
  /**
   * TRUE when this row was written by the recorder's fast trigger scan the
   * minute the strike crossed into "★ Very strong", rather than by the interval
   * leaderboard. Its slot is the exact ET minute of the crossing.
   */
  live?: boolean
}

/** `live` is true only when EVERY row in the bucket was trigger-written. */
export interface SlotBucket {
  slot: string
  ts: string
  live?: boolean
  rows: Row[]
}

/**
 * One row of the EOD scorecard — `/proxy/gex-change-top-results → rows[]`.
 *
 * @see §FIELDS ON THE WIRE WITH NO SURFACE — nine of these fields are rendered
 * nowhere in v2, `sustained_pct` most notably.
 */
export interface ResultRow {
  watch_id: number
  symbol: string
  expiry: string
  strike: number
  side: string | null
  first_slot: string | null
  slots: number | null
  /** @neverReadInV2 On the wire, rendered nowhere. See C9. */
  best_rank: number | null
  /** @neverReadInV2 On the wire, rendered nowhere — the card's `score N` reads
   *  `Row.score`, off the SLOT feed, not this one. See C9. */
  score: number | null
  entry: number | null
  entry_ts: number | null
  max_mark: number | null
  max_ts: number | null
  max_pct: number | null
  /** @neverReadInV2 On the wire, rendered nowhere — only `min_pct` reaches the
   *  screen, in the never-coloured "Low %" column. See C9. */
  min_mark: number | null
  min_pct: number | null
  close_mark: number | null
  /** @neverReadInV2 On the wire, rendered nowhere — only `max_ts` gets a
   *  "Peak at" column; the close has no timestamp on screen. See C9. */
  close_ts: number | null
  close_pct: number | null
  /** @neverReadInV2 On the wire, rendered nowhere. How many snapshots the row
   *  was computed over — i.e. how much to trust it — and nothing shows it. See C9. */
  samples: number | null
  /** @neverReadInV2 On the wire, rendered nowhere. WHEN the low printed, which
   *  would let peak and low be ORDERED instead of merely compared. See C9. */
  min_ts?: number | null
  /** @neverReadInV2 On the wire, rendered nowhere. */
  sustained_mark?: number | null
  /**
   * @neverReadInV2 On the wire, rendered nowhere — and it is the one that
   * matters. v2's own type comment calls the sustained trio "the best level that
   * held for two consecutive snapshots — THE FILLABLE MOVE, as opposed to
   * `max_pct`'s single print". So the wire carries the honest number, and
   * `max_pct` — the single print — is what drives the grade (`gradePoints`), the
   * whole scorecard summary and the card headline instead. Nothing on this tab
   * reads `sustained_pct` at all. Kept, tagged, unsurfaced: see §FIELDS ON THE
   * WIRE WITH NO SURFACE. See C9.
   */
  sustained_pct?: number | null
  /** @neverReadInV2 On the wire, rendered nowhere. */
  sustained_ts?: number | null
  /** The label, computed server-side by `_lib-pick-grade.cjs`. Absent on rows
   *  frozen before grading existed — `gradeFor()` falls back for those. */
  grade?: string | null
  grade_pts?: number | null
}

/** One snapshot of the auto-probed contract. `/proxy/gex-change-top-history → points[]`. */
export interface PickPoint {
  ts: number
  mark: number | null
  net_gex: number | null
}

/** The probed contract's identity, as the history endpoint returns it. */
export interface PickContract {
  ticker: string
  expiration: string
  strike: number
  side: string
  added_price: number | null
}

/** Per-`watch_id` history cache entry. `error` and `points` are mutually informative. */
export interface PickHist {
  points: PickPoint[]
  contract: PickContract | null
  error?: string
}

/** The back face's two series. There is no third; see METRICS. */
export type Metric = 'mark' | 'net_gex'

// ─────────────────────────────────────────────────────────────────────────────
// FIELDS ON THE WIRE WITH NO SURFACE
//
// ELEVEN fields arrive on every payload and are rendered by nothing in v2. They
// are typed above and tagged `@neverReadInV2` individually, so that step 3 makes
// a decision about them instead of losing them:
//
//   Row (2):        z_score, window_min
//   ResultRow (9):  best_rank, score, min_mark, close_ts, samples, min_ts,
//                   sustained_mark, sustained_pct, sustained_ts
//
// `sustained_pct` is the interesting one. Its own type comment calls it "the
// fillable move, as opposed to max_pct's single print" — i.e. it is the honest
// version of the number the whole scorecard, the whole grade ladder and the
// whole card headline are built on, and the UI shows `max_pct` instead.
//
// NO SURFACE IS INVENTED FOR THEM HERE. Adding a column, a tooltip or a second
// headline would be a product decision made silently in a transcription pass,
// which is the other failure this exercise exists to prevent. The spec prose at
// C9 says "seven"; the true count on ResultRow is nine, listed above.
//
// Spec: docs/parity/scanner.md Part C, rows C7 and C9.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry-mark floor for a pick to count (C56, C63, C64, C106, C122).
 *
 * Below this a contract's % moves are an artifact of tick size, not a tradable
 * result — $0.05 to $0.20 is "+300%". Applied to the hourly cards AND the
 * scorecard so the two never disagree about which picks exist.
 */
export const ENTRY_FLOOR = 0.5

/**
 * C13 — 60 SECONDS, not five minutes, and deliberately so: the recorder's
 * trigger scan files a crossing within a minute of it happening, and a 5-minute
 * poll threw that away and put the card on screen up to five minutes stale,
 * which is the whole problem the trigger scan was added to fix.
 *
 * v2 kept polling while the tab was hidden (there was no visibility guard).
 * v3's `query()` pauses polling on a hidden tab by default, which is the right
 * behaviour and is a change of BEHAVIOUR, not of cadence — recorded in
 * gexChangeTopData.ts.
 */
export const POLL_MS = 60_000

/**
 * C14 — above this many open (face-down) cards the per-card history refresh
 * stops entirely. After a "Flip all" there can be ~65 open cards and re-polling
 * all of them would be 65 requests/min against the proxy for charts nobody is
 * reading; beyond this the data loaded on open stands until Refresh.
 *
 * A hand-rolled rate limiter standing in for a batched history endpoint.
 */
export const OPEN_CARD_POLL_MAX = 8

/**
 * C15 — "Flip all" fetched uncached histories in waves of this size, each wave a
 * `Promise.all`, recursing while any remained.
 *
 * THE RECURSION ITSELF IS NOT PORTED (see gexChangeTopData.ts): `query()`'s
 * dedupe and cache already collapse the repeat requests the wave scheduler was
 * hand-rolling around, and the reason it existed at all is that there is no
 * batch history endpoint. The NUMBER is kept because it records the rate ceiling
 * the proxy was being protected by — ~65 open cards must not become 65
 * simultaneous requests — and step 3 needs it if it staggers the opens.
 */
export const FLIP_ALL_WAVE_SIZE = 6

/** C136 — the back face's metric toggle, in this order. Default is `mark`. */
export const METRICS: readonly { key: Metric; label: string }[] = [
  { key: 'mark', label: 'Price' },
  { key: 'net_gex', label: 'Net GEX' },
]

/** C136 — one metric for the WHOLE tab, not one per card. Switching it on one
 *  open card switches every open card at once. Persists to nothing. */
export const DEFAULT_METRIC: Metric = 'mark'

/** C24 — month abbreviations for `capturedLabel`. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** C27 — RTH is 09:30 ET inclusive to 16:00 ET exclusive, in minutes past midnight. */
const RTH_OPEN_MIN = 9 * 60 + 30
const RTH_CLOSE_MIN = 16 * 60

// ─────────────────────────────────────────────────────────────────────────────
// NUMBER AND TIME FORMATTERS (C17–C27)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C17 — the big Δ headline: "-8.6M", "1.2B". No `$` sign.
 *
 * THERE IS NO SUB-1M BRANCH. A Δ of 200,000 — exactly the ★ Very strong
 * threshold the subtitle names — prints "0.2M", and 40,000 prints "0.0M". The
 * sign is an ASCII hyphen, not U+2212, and only negatives carry one.
 */
export function fmtBig(v: number | null): string {
  if (v == null) return EM_DASH
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`
  return `${s}${(a / 1e6).toFixed(1)}M`
}

/**
 * C18 — "5,900" for an integer strike, "5900.5" bare for a fractional one.
 * Takes a non-nullable number: there is no em-dash path.
 */
export function fmtStrike(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('en-US') : String(v)
}

/** C19 — spot to 2dp. Note `!(v > 0)` also catches 0 and NaN. */
export function fmtSpot(v: number | null): string {
  return v == null || !(v > 0) ? EM_DASH : v.toFixed(2)
}

/** C20 — an option mark to 2dp, no `$`. */
export function fmtPx(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? EM_DASH : Number(v).toFixed(2)
}

/**
 * C21 — signed dollars for the Net GEX axis: "+$1.20M", "−$340K".
 *
 * The minus is U+2212 MINUS SIGN, not a hyphen — unlike `fmtBig` above, which
 * uses ASCII. Two conventions on one tab; both are copied because both are
 * already on screen. Zero takes "+".
 */
export function fmtGex(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH
  const a = Math.abs(v)
  const sign = v >= 0 ? '+' : '−'
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  return `${sign}$${(a / 1e3).toFixed(0)}K`
}

/**
 * C22 — a percent already in percent units, zero decimals, `+` on non-negatives.
 * Zero renders "+0%". Negatives keep `toFixed`'s ASCII hyphen.
 *
 * NOT the shared `fmtPct` from @/pages/scanner/format, which takes a 0–1
 * fraction at one decimal. Different contract, different name.
 */
export function fmtPctSigned(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? EM_DASH : `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`
}

/**
 * C23 — "HH:MM" (24h ET) → "10:30 AM ET". "00:30" → "12:30 AM ET";
 * "12:00" → "12:00 PM ET". A slot with no ":" substitutes "00" for the minutes.
 */
export function slotLabel(slot: string): string {
  const [hStr, mStr] = slot.split(':')
  const h = Number(hStr)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${mStr ?? '00'} ${ampm} ET`
}

/**
 * C24 — "Jul 30 · 10:30 AM ET". Separator is U+00B7.
 *
 * Stamped on each pick card so a single-card screenshot carries its own capture
 * time (v2's slot header was `data-noshot` and therefore absent from the image).
 * A day that does not match `YYYY-MM-DD` exactly — including `date === ""`
 * before the first response lands — returns JUST the time, with no date.
 */
export function capturedLabel(day: string, slot: string): string {
  const time = slotLabel(slot)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '')
  if (!m) return time
  // `String()` rather than `?? ''`: under noUncheckedIndexedAccess an out-of-range
  // month is `undefined`, and v2's template literal printed the word "undefined".
  // Substituting an empty string here would be a silent behaviour change.
  return `${String(MONTHS[Number(m[2]) - 1])} ${Number(m[3])} · ${time}`
}

/** C25 — epoch ms → "1:42 PM". PINNED TO ET, with no zone suffix printed. */
export function fmtClock(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return EM_DASH
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * C26 — "42s ago" / "6m ago" / "3h ago".
 *
 * Recomputed only on render, so a card left open shows a frozen "42s ago" until
 * something re-renders it. v2's behaviour, kept.
 */
export function ago(ts: number | null | undefined): string {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return EM_DASH
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

/**
 * C27 — is this epoch-ms inside the ET cash session?
 *
 * Weekends are false. Otherwise 09:30 ET INCLUSIVE to 16:00 ET EXCLUSIVE.
 * HOLIDAYS ARE NOT EXCLUDED — a half-day or a market holiday passes this filter
 * and its (empty) snapshot range is simply empty. That is v2's behaviour.
 *
 * Applied to `/proxy/gex-change-top-history → points[]` at fetch time, which is
 * why "now" on the card back means "the last RTH snapshot", not wall-clock now.
 */
export function isRth(ts: number): boolean {
  if (!Number.isFinite(ts)) return false
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date(ts))
  const get = (k: string): string | undefined => p.find((x) => x.type === k)?.value
  const wd = get('weekday')
  if (wd === 'Sat' || wd === 'Sun') return false
  const mins = Number(get('hour')) * 60 + Number(get('minute'))
  return mins >= RTH_OPEN_MIN && mins < RTH_CLOSE_MIN
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GRADE LADDER — THE CROSS-PART CONTRACT (C28–C41)
//
// A letter for what the contract actually DID after it was flagged, so a slot
// can be read at a glance instead of squinting at three percentages.
//
// 100 points, three parts:
//   Peak  (0–55)  how much gain was ever on offer     — max_pct   (MFE)
//   Pain  (0–25)  how much heat it took getting there — min_pct   (MAE)
//   Close (0–20)  where it actually finished          — close_pct
//
// HARD RULE: `max_pct <= 0` is an F no matter what the other two say. A pick
// that never traded above its flag mark offered no exit at all, and that is the
// case this grade exists to name — avg peak hides it, because one +300% runner
// pays for four that went straight to red. Pain and close credit must not
// launder a never-green pick up into a D.
//
// EVERY BOUNDARY BELOW IS READ BACK BY PICK STUDY (Part D). Changing one is a
// cross-part change, not a local tweak.
// ─────────────────────────────────────────────────────────────────────────────

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'

export interface GradeInfo {
  grade: Grade
  pts: number
  neverGreen: boolean
  why: string
}

/**
 * C28 — this exact order drives the distribution strip (C68) and validates the
 * `proj_grade` / server `grade` strings.
 */
export const GRADE_ORDER: readonly Grade[] = ['A+', 'A', 'B', 'C', 'D', 'F']

/**
 * C37 — the grade ink.
 *
 * SIX STEPS PAINTED WITH FOUR COLOURS: A+ and A are the same value, and so are
 * C and D. Colour alone cannot separate them; the tooltip (GRADE_NOTE) is the
 * only thing that does. That is v2's ramp and it is transcribed rather than
 * expanded — inventing two more steps here would change what the strip means.
 *
 * COLLAPSE (docs/parity/scanner.md, "the one colour decision"): v2 painted A+/A
 * with `HOME_THEME.green` #8ECAE6 and F with `HOME_THEME.red` #EF4444. In the
 * grade ramp those two are the POSITIVE and NEGATIVE semantics, so they take
 * MOVE_UP and MOVE_DOWN like every other signed value on this tab. B keeps the
 * v2 teal and C/D the v2 orange, which are neither.
 */
export const GRADE_COLOR: Record<Grade, string> = {
  'A+': MOVE_UP,
  A: MOVE_UP,
  B: V2.cyan,
  C: V2.orange,
  D: V2.orange,
  F: MOVE_DOWN,
}

/**
 * C38 — the tooltip on every grade pill and the whole tooltip on every
 * distribution chip. Verbatim; the range hyphens are ASCII and the clause
 * separators are em dashes.
 */
export const GRADE_NOTE: Record<Grade, string> = {
  'A+': '85-100 pts — a big gain was on offer, it was cheap to hold, and it finished well.',
  A: '72-84 pts — a real move (roughly +50% or better) without punishing heat.',
  B: '58-71 pts — a tradable pop, or a bigger one that took real drawdown first.',
  C: '44-57 pts — small gain on offer, or a decent peak paid for with heat.',
  D: '28-43 pts — barely ticked green before it rolled.',
  F: 'Under 28 pts, or never traded green at all — no exit was ever on offer.',
}

/**
 * C29–C32 — 0–100 for a scorecard row. `null` when nothing was ever snapshotted
 * after entry, which is the ONLY way this returns null.
 *
 * PEAK, 0–55, on `maxPct`, first match wins:
 *   >= 150 → 55 · >= 100 → 50 · >= 50 → 42 · >= 30 → 33 · >= 20 → 26 ·
 *   >= 10 → 18 · > 0 → 8 · else → 0
 * Every boundary is `>=` except the last, which is strict `> 0`. `maxPct === 0`
 * therefore scores 0 peak AND trips `neverGreen`.
 *
 * PAIN, 0–25, on `minPct` (defaulted):
 *   >= -10 → 25 · >= -20 → 20 · >= -30 → 15 · >= -45 → 9 · >= -60 → 4 · else → 0
 *
 * CODE-VS-COMMENT CONFLICT (v2 lines 184–186). v2's comment reads: "No low
 * recorded -> assume it was not free. Half credit, so a pick with no MAE on file
 * can never outrank one that proved it stayed shallow." The default it actually
 * uses is -25, which lands in the `>= -30 → 15` bucket — 15 of 25, i.e. SIXTY
 * percent, not half. THE CODE WINS: -25 and 15 are transcribed exactly, because
 * Pick Study has been reading 15 back for every ungraded-MAE pick on file and
 * "fixing" it to 12.5 would silently re-grade that history. The comment is what
 * is wrong here, not the number.
 *
 * CLOSE, 0–20, on `closePct` (nullable):
 *   null → 8 · >= 50 → 20 · >= 20 → 16 · >= 0 → 11 · >= -20 → 6 · >= -50 → 2 ·
 *   else → 0
 * Note the null default of 8 sits BETWEEN the `>= -20` bucket (6) and the
 * `>= 0` bucket (11) — a flat close scores 11, better than having no close at
 * all, and a -10% close scores 6, worse. That ordering is deliberate.
 *
 * Max 55 + 25 + 20 = 100. Minimum for a pick that traded green at all: 8+0+0 = 8.
 */
export function gradePoints(
  maxPct: number | null,
  minPct: number | null,
  closePct: number | null,
): number | null {
  if (maxPct == null || !Number.isFinite(maxPct)) return null
  const peak =
    maxPct >= 150
      ? 55
      : maxPct >= 100
        ? 50
        : maxPct >= 50
          ? 42
          : maxPct >= 30
            ? 33
            : maxPct >= 20
              ? 26
              : maxPct >= 10
                ? 18
                : maxPct > 0
                  ? 8
                  : 0
  // See the CODE-VS-COMMENT CONFLICT note above: -25 scores 15/25, not 12.5/25.
  const m = minPct == null || !Number.isFinite(minPct) ? -25 : minPct
  const pain = m >= -10 ? 25 : m >= -20 ? 20 : m >= -30 ? 15 : m >= -45 ? 9 : m >= -60 ? 4 : 0
  const c = closePct == null || !Number.isFinite(closePct) ? null : closePct
  const close =
    c == null ? 8 : c >= 50 ? 20 : c >= 20 ? 16 : c >= 0 ? 11 : c >= -20 ? 6 : c >= -50 ? 2 : 0
  return peak + pain + close
}

/** The subset of a scorecard row `gradeFor` reads. Typed so a Row cannot be passed. */
export type GradeInput = Pick<
  ResultRow,
  'max_pct' | 'min_pct' | 'close_pct' | 'grade' | 'grade_pts'
>

/**
 * C33–C36 — the grade for a scorecard row, or `null` for a row with nothing
 * scored yet (which renders NO pill at all — no placeholder, no dash).
 *
 * TWO PATHS. The server is the source of truth (server-v2/_lib-pick-grade.cjs);
 * the local ladder below it exists only for rows frozen before grading shipped.
 *
 * LETTER LADDER (local path), all `>=`:
 *   A+ >= 85 · A >= 72 · B >= 58 · C >= 44 · D >= 28 · F below 28
 * …AND F unconditionally when `max_pct <= 0` or is non-numeric. A pick that
 * traded green but only scored 8–27 is also an F.
 *
 * // BUG (v2): the SERVER path never applies the never-green override while the
 * // local path does. A `/results` row carrying `grade: "B"` with `max_pct <= 0`
 * // renders a B pill AND is counted in the "never green N (P%)" figure beside
 * // it (C70), because `neverGreen` is computed on BOTH paths and only ACTED ON
 * // by one. The two halves of the same strip disagree about the same pick, by
 * // construction. Transcribed as written — the server is the authority on the
 * // letter, and quietly overriding it here would put the client and
 * // _lib-pick-grade.cjs into a fight the user would see as a flickering grade.
 * // Step 3 decides: either the server stops shipping such a row, or the client
 * // stops counting it, but not both silently.
 */
export function gradeFor(r: GradeInput | null | undefined): GradeInfo | null {
  if (!r) return null
  if (r.grade && (GRADE_ORDER as readonly string[]).includes(r.grade)) {
    const g = r.grade as Grade
    const p = Number(r.grade_pts)
    return {
      grade: g,
      // Unparseable grade_pts contributes 0, which drags the GPA (C69) down
      // without changing the letter. v2's behaviour.
      pts: Number.isFinite(p) ? p : 0,
      neverGreen: !(Number(r.max_pct) > 0),
      // C35 — the "N/100 · " prefix is omitted when grade_pts is not finite, and
      // this path NEVER carries the "Never traded green" wording even when
      // neverGreen is true. See the BUG note above.
      why: `${Number.isFinite(p) ? `${p}/100 · ` : ''}peak ${fmtPctSigned(r.max_pct)} · low ${fmtPctSigned(r.min_pct)} · close ${fmtPctSigned(r.close_pct)}`,
    }
  }
  const pts = gradePoints(r.max_pct, r.min_pct, r.close_pct)
  if (pts == null) return null
  const neverGreen = !(Number(r.max_pct) > 0)
  const grade: Grade = neverGreen
    ? 'F'
    : pts >= 85
      ? 'A+'
      : pts >= 72
        ? 'A'
        : pts >= 58
          ? 'B'
          : pts >= 44
            ? 'C'
            : pts >= 28
              ? 'D'
              : 'F'
  // C36 — note the CAPITAL "Peak" in the never-green variant against the
  // lowercase "peak" in the other two. Copied, not normalised.
  const why = neverGreen
    ? `Never traded green. Peak ${fmtPctSigned(r.max_pct)} · low ${fmtPctSigned(r.min_pct)} · close ${fmtPctSigned(r.close_pct)} — no exit was ever on offer.`
    : `${pts}/100 · peak ${fmtPctSigned(r.max_pct)} · low ${fmtPctSigned(r.min_pct)} · close ${fmtPctSigned(r.close_pct)}`
  return { grade, pts, neverGreen, why }
}

/** C39 — the grade pill's full `title=`. `provisional` is `!frozen` at all three call sites. */
export function gradePillTitle(info: GradeInfo, provisional: boolean): string {
  return `${GRADE_NOTE[info.grade]}\n${info.why}${provisional ? `\n${GRADE_PILL_PROVISIONAL_NOTE}` : ''}`
}

/** C39 — the extra tooltip line a live (unfrozen) session adds. */
export const GRADE_PILL_PROVISIONAL_NOTE =
  'Provisional — the session is still live, so peak/close can still move.'

/** C39 — the glyph appended to a provisional pill. U+00B7. */
export const GRADE_PILL_PROVISIONAL_MARK = '·'

/**
 * C40 — the ink key for a PROJECTED grade string.
 *
 * An unrecognised grade string is COLOURED as C but its raw text is still
 * printed by the pill, unchanged. The projection is drawn hollow, dashed and
 * prefixed on purpose: a prediction must never read like a result at a glance.
 */
export function projGradeKey(grade: string): Grade {
  return (GRADE_ORDER as readonly string[]).includes(grade) ? (grade as Grade) : 'C'
}

/** C40 — the literal prefix inside the dashed projection pill. */
export const PROJ_PILL_PREFIX = 'proj'

/** C41 — the projection pill's `title=`, verbatim. Names Part D explicitly. */
export function projPillTitle(grade: string, pts: number | null | undefined): string {
  return `Projected ${grade}${pts == null ? '' : ` (${pts}/100)`} at capture, from the rule in server-v2/config/pick-proj-rule.json. This is a prediction made before the pick did anything — compare it against the solid grade pill, and against the Pick Study tab's calibration table.`
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN COLOURS
//
// // BUG (v2): the SAME question — "is this number positive?" — is answered
// // three different ways on this one tab, so a pick sitting at exactly
// // break-even paints GREEN in the scorecard table, RED on the card front and
// // NEUTRAL on the card back, all at the same moment for the same contract:
// //
// //   C82  Peak % (table)  `>= 0` → up          … 0 is up
// //   C102 peakColor (card front) `> 0` → up, else down  … 0 is DOWN
// //   C104 pnlColor (card back)   `> 0` up / `< 0` down / else neutral … 0 is NEITHER
// //
// // A fourth convention hides in C113: the Δ headline coalesces a null
// // `latest_chg` to 0 before testing `>= 0`, so an em dash — the "no data"
// // glyph — is painted in the UP colour.
// //
// // All four are transcribed as separate named functions rather than collapsed,
// // because collapsing them here would change what is on screen without anyone
// // choosing to. Step 3 picks ONE rule and deletes the others.
//
// COLLAPSE: v2 painted every one of these with `HOME_THEME.green` #8ECAE6 (a
// light blue) and `HOME_THEME.red` #EF4444. Both are directional here, so both
// take the direction tokens — MOVE_UP and MOVE_DOWN — per the decision recorded
// in docs/parity/scanner.md. The neutral case takes T.text, which is v2's
// `HOME_THEME.text`; there is no muted colour on this tab (v2's `HT.muted` is
// the same #FFFFFF as `HT.text`), so hierarchy is size and opacity, never hue.
//
// AND THE OTHER HALF OF THAT COLLAPSE — CHROME. `HOME_THEME.green` was doing
// FOUR unrelated jobs in v2: positive/up (the functions below), the call SIDE
// (`sideColor`, which keeps the v2 light-blue token because side is not sign),
// and two pieces of pure chrome — the scorecard's twelve column headers (v2's
// `th` colour, C74) and the Card subtitle (C45). A `<th>` reading "Peak %" was
// painted the same value as a +140% peak underneath it. THE CHROME HALF
// COLLAPSES TO `T.muted`: headers and subtitle are labels, and a label must not
// borrow the ink that means "this number went up". Recorded at both call sites
// below (SCORECARD_COLUMNS and CARD_SUBTITLE) so step 3 cannot paint them green
// again by copying v2's `th`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C82 — Peak % in the scorecard table. `null` neutral, `>= 0` up. ZERO IS UP.
 *
 * The same `max_pct` painted by `peakPctCardColor` (`> 0`, so zero is DOWN) on
 * the card front and by `pnlColor` (zero NEUTRAL) on the card back. One value,
 * three inks, all three on screen at once.
 */
export function peakPctTableColor(v: number | null): string {
  return v == null ? T.text : v >= 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * C85 — Close % in the scorecard table. Same `>= 0` rule as `peakPctTableColor`,
 * so a flat close paints UP here — while C62's "closed green" COUNTER requires a
 * strict `> 0` and does not count it (see `ScorecardSummary.greenClose`). The
 * colour and the count disagree about the same row.
 */
export function closePctTableColor(v: number | null): string {
  return v == null ? T.text : v >= 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * C102 — the card front's peak headline and its "high" figures. Strict `> 0`, so
 * ZERO IS DOWN — against `peakPctTableColor`'s `>= 0` (zero UP) in the table and
 * `pnlColor`'s three-way (zero NEUTRAL) on the card back.
 */
export function peakPctCardColor(v: number | null): string {
  return v == null ? T.text : v > 0 ? MOVE_UP : MOVE_DOWN
}

/**
 * C104 — the card back's demoted "now" line. `> 0` up, `< 0` down, ZERO NEUTRAL —
 * the third answer, against `peakPctTableColor`'s `>= 0` and
 * `peakPctCardColor`'s `> 0`. A break-even pick is green in the table, red on the
 * front and white here, at the same moment.
 */
export function pnlColor(v: number | null): string {
  return v == null ? T.text : v > 0 ? MOVE_UP : v < 0 ? MOVE_DOWN : T.text
}

/**
 * C113 — the Δ headline.
 *
 * `latest_chg == null` coalesces to 0 and therefore reports UP, which paints the
 * em dash in the positive colour. Kept: see the fourth convention in the BUG
 * note above.
 */
export function deltaIsUp(latestChg: number | null): boolean {
  return (latestChg ?? 0) >= 0
}

/** C113 — the Δ headline's ink, from `deltaIsUp`. */
export function deltaColor(latestChg: number | null): string {
  return deltaIsUp(latestChg) ? MOVE_UP : MOVE_DOWN
}

/** C118 — "% vs open" on the card front. `null` neutral, `>= 0` up. */
export function pctOpenColor(v: number | null): string {
  return v == null ? T.text : v >= 0 ? MOVE_UP : MOVE_DOWN
}

/** C58 — "avg peak" in the summary line. NULL IS PAINTED DOWN, and prints an em dash. */
export function avgPeakColor(v: number | null): string {
  return v != null && v >= 0 ? MOVE_UP : MOVE_DOWN
}

/** C70 — the "never green" count. Any non-zero is DOWN; exactly zero is UP. */
export function neverGreenColor(n: number): string {
  return n ? MOVE_DOWN : MOVE_UP
}

/**
 * C77, C126 — the contract's side ink.
 *
 * Anything that is not the string "P" paints as a call, `null` included. That is
 * why the scorecard's Contract cell is call-coloured for a row with no side at
 * all.
 *
 * COLLAPSE NOTE: this is v2's `HOME_THEME.green` in its CALL-SIDE role, not its
 * positive/up role, so it keeps the v2 light-blue token (`V2.green`) rather than
 * becoming MOVE_UP. Side is not sign, and painting a put in the "down" colour
 * would say something about the trade that this tab does not know.
 */
export function sideColor(side: string | null | undefined): string {
  return side === 'P' ? V2.orange : V2.green
}

/** C92 — the slot header. A live-trigger section is cyan; a scheduled capture is orange. */
export function slotHeaderColor(live: boolean | undefined): string {
  return live ? V2.cyan : V2.orange
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCORECARD (C54–C70)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C56 — the filter every scorecard number is computed over.
 *
 * A row with `entry == null` is dropped in BOTH modes. The default comparator is
 * STRICT `>`, so an entry of exactly $0.50 is excluded — the exact complement of
 * `cheapIdsFrom`'s `<=` below, which is what keeps the badge on the cards and
 * the absence from the table describing the same set.
 */
export function filterResults(results: readonly ResultRow[], scoreCheap: boolean): ResultRow[] {
  return results.filter((r) => r.entry != null && (scoreCheap || r.entry > ENTRY_FLOOR))
}

/**
 * C64 — the ids at or under the floor. Note `<=`, the exact complement of C56's `>`.
 * These are the picks the scorecard will not rank, and the cards therefore badge.
 */
export function cheapIdsFrom(results: readonly ResultRow[]): Set<number> {
  const s = new Set<number>()
  for (const r of results) if (r.entry != null && r.entry <= ENTRY_FLOOR) s.add(r.watch_id)
  return s
}

/** C98 — the entry basis by `watch_id`. Only rows that actually have an entry. */
export function entryByIdFrom(results: readonly ResultRow[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of results) if (r.entry != null) m.set(r.watch_id, r.entry)
  return m
}

/** C114 — the whole scorecard row by `watch_id`. A card reads its grade straight off this. */
export function resultByIdFrom(results: readonly ResultRow[]): Map<number, ResultRow> {
  const m = new Map<number, ResultRow>()
  for (const r of results) m.set(r.watch_id, r)
  return m
}

/**
 * C64 — how many CARDS on screen sit under the floor, not how many scorecard
 * rows do. If `/results` has sub-floor rows but `slots` is empty for that date
 * this is 0 and the cheap-entry toggle never renders at all.
 */
export function countCheapCards(
  slots: readonly SlotBucket[],
  cheapIds: ReadonlySet<number>,
): number {
  if (cheapIds.size === 0) return 0
  let n = 0
  for (const hb of slots) {
    for (const r of hb.rows) if (r.watch_id != null && cheapIds.has(r.watch_id)) n += 1
  }
  return n
}

export interface ScorecardSummary {
  /** C56 — the rows the table renders, in the server's order. */
  filtered: ResultRow[]
  /** C58–C61 — the denominator for avg peak and the three hit counts. */
  withPeak: ResultRow[]
  /** C57 — `filtered.length`. The summary span is omitted entirely when this is 0. */
  count: number
  /** C58 — mean `max_pct` over `withPeak`, or null when nothing has a peak. */
  avgPeak: number | null
  /** C59–C61 — `max_pct >= 25 / 50 / 100`, inclusive, over `withPeak`. */
  hit25: number
  hit50: number
  hit100: number
  /** C62 — `close_pct > 0`, STRICT, over `filtered` (not `withPeak`). */
  greenClose: number
  /** C.G — the graded rows, in `filtered` order. Ungraded rows drop out. */
  graded: GradeInfo[]
  /** C68 — count per letter, all six keys present even at zero. */
  gradeCounts: Record<Grade, number>
  /** C70 — how many graded picks never printed above their entry. */
  neverGreen: number
  /** C70 — as a percentage of `graded.length`, or null when nothing is graded. */
  neverGreenPct: number | null
  /** C69 — mean `pts` across BOTH server-graded and locally-graded rows. */
  gpa: number | null
}

/**
 * C56–C70 — every number in the scorecard header, the summary line and the
 * grade distribution strip, computed once.
 *
 * WATCH THE DENOMINATORS, they are not the same one:
 *   • avg peak and the three ≥ hit counts are over `withPeak` — a pick with no
 *     `max_pct` is in neither numerator nor denominator.
 *   • "closed green" is over `filtered`, so a pick with no close counts against
 *     it.
 *   • the GPA and "never green" are over `graded`, which drops any row
 *     `gradeFor` returned null for.
 * Three populations, three different stories about the same date. v2's, copied.
 */
export function scorecardSummary(
  results: readonly ResultRow[],
  scoreCheap: boolean,
): ScorecardSummary {
  const filtered = filterResults(results, scoreCheap)
  const withPeak = filtered.filter((r) => r.max_pct != null)
  const hit = (n: number): number => withPeak.filter((r) => (r.max_pct as number) >= n).length
  const avgPeak = withPeak.length
    ? withPeak.reduce((a, r) => a + (r.max_pct as number), 0) / withPeak.length
    : null
  const greenClose = filtered.filter(
    (r) => r.close_pct != null && (r.close_pct as number) > 0,
  ).length

  const graded = filtered
    .map((r) => gradeFor(r))
    .filter((g): g is GradeInfo => g != null)
  const gradeCounts = {} as Record<Grade, number>
  for (const g of GRADE_ORDER) gradeCounts[g] = graded.filter((x) => x.grade === g).length
  const neverGreen = graded.filter((g) => g.neverGreen).length
  const neverGreenPct = graded.length ? (neverGreen / graded.length) * 100 : null
  const gpa = graded.length ? graded.reduce((a, x) => a + x.pts, 0) / graded.length : null

  return {
    filtered,
    withPeak,
    count: filtered.length,
    avgPeak,
    hit25: hit(25),
    hit50: hit(50),
    hit100: hit(100),
    greenClose,
    graded,
    gradeCounts,
    neverGreen,
    neverGreenPct,
    gpa,
  }
}

/**
 * C83 — the scorecard table's "$/ct" column. One contract, so ×100.
 *
 * Computed STRICTLY from `r.max_mark`, unlike the card's version below which may
 * use the client fallback peak. Never coloured by sign in v2, unlike the Peak %
 * column immediately beside it.
 */
export function peakDollarsFromRow(r: ResultRow): number | null {
  return r.entry != null && r.max_mark != null ? (r.max_mark - r.entry) * 100 : null
}

/** C83, C133 — "+$412" / "−$88". Zero decimals; the minus is U+2212. */
export function fmtDollarsPerContract(v: number): string {
  return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(0)}`
}

/** C78 — "10:30 AM" with the " ET" suffix stripped, or an em dash. */
export function flaggedLabel(firstSlot: string | null): string {
  return firstSlot ? slotLabel(firstSlot).replace(' ET', '') : EM_DASH
}

/** C78 — the "×3" multiplier appended when a pick was flagged in more than one slot. */
export function slotsMultiplier(slots: number | null): string {
  return slots != null && slots > 1 ? ` ×${slots}` : ''
}

/** C73 — the table row key. `watch_id` alone is not unique across first slots. */
export function resultRowKey(r: ResultRow): string {
  return `${r.watch_id}-${r.first_slot}`
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PICK CARD (C96–C137)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C96 — the flip / open / capture key for a card.
 *
 * OMITS `expiry`, while the React render key (C107) is
 * `${symbol}-${expiry}-${strike}`. Two different expiries on the same symbol and
 * strike inside one slot would therefore SHARE flip state and open state while
 * rendering as two tiles. Transcribed as written; adding `expiry` here would be
 * a silent behaviour change to which cards turn over together.
 */
export function cardId(row: Row, slot: string): string {
  return `${row.symbol}-${row.strike}-${slot}`
}

/** C107 — the React key. Note it differs from `cardId`; see the note there. */
export function cardRenderKey(row: Row): string {
  return `${row.symbol}-${row.expiry}-${row.strike}`
}

/**
 * C97 — the side the CARD derives, from strike against spot.
 *
 * Strike BELOW spot ⇒ put. A null or zero spot ⇒ call. The scorecard table uses
 * the SERVER's `r.side` instead (C77), so the two can disagree about the same
 * contract on the same screen. Both are transcribed; neither is authoritative
 * over the other in v2.
 */
export function deriveSide(row: Pick<Row, 'strike' | 'spot'>): 'C' | 'P' {
  return row.spot != null && row.spot > 0 && row.strike < row.spot ? 'P' : 'C'
}

/** C117 — distance from spot as an unsigned percent. A strike either side reads "OTM". */
export function otmPctFor(row: Pick<Row, 'strike' | 'spot'>): number | null {
  return row.spot && row.spot > 0 ? (Math.abs(row.strike - row.spot) / row.spot) * 100 : null
}

/** Everything the scorecard payload contributes to a card, indexed once per load. */
export interface ScorecardIndex {
  entryById: Map<number, number>
  resultById: Map<number, ResultRow>
  cheapIds: Set<number>
}

/** Build all three indexes in one pass over `/results`. */
export function indexResults(results: readonly ResultRow[]): ScorecardIndex {
  return {
    entryById: entryByIdFrom(results),
    resultById: resultByIdFrom(results),
    cheapIds: cheapIdsFrom(results),
  }
}

/** Every derived value a pick card's two faces read. */
export interface PickCardView {
  /** C96 — flip / open key. */
  cid: string
  /** C107 — React key. */
  renderKey: string
  /** null on a pre-auto-probe row, which is also unclickable and has no back face. */
  wid: number | null
  /** C97 — the CARD's side, derived from strike vs spot. */
  side: 'C' | 'P'
  /** C113 — Δ direction, with null coalesced to 0. */
  up: boolean
  /** C117 — unsigned distance from spot, or null (the span is omitted entirely). */
  otmPct: number | null
  /** C98 — the entry basis: scorecard first, `added_price` second, null last. */
  entry: number | null
  /** C105 — the scorecard's entry snapshot time, if it has one. */
  entryTs: number | null
  /** C99 — the scorecard's peak, or the client fallback scan. */
  peakMark: number | null
  peakTs: number | null
  /** C100 — the scorecard's `max_pct`, or computed from entry and `peakMark`. */
  peakPct: number | null
  /** C101 — dollars per contract at the peak. May use the fallback peak. */
  peakDollars: number | null
  /** C103 — the last RTH snapshot's mark, and its timestamp (SEPARATE scans). */
  lastMark: number | null
  lastTs: number | null
  /** C104 — percent from entry to `lastMark`. */
  pnlPct: number | null
  /** C105 — "1:42 PM", or the slot itself for a card with no entry snapshot. */
  trigLabel: string
  /** C106 — under the $0.50 floor, so present-but-discounted and badged. */
  underFloor: boolean
  /** C114 — the SAME scorecard row the entry basis came from. */
  grade: GradeInfo | null
  /** C116 / C129 — "Jul 30 · 10:30 AM ET". */
  captured: string
  /** C10 — the RTH-filtered history for this pick, or an empty array. */
  points: PickPoint[]
}

/**
 * C96–C106, C114 — every derived value on a pick card, in one place.
 *
 * THE ENTRY BASIS (C98) IS THE POINT OF THIS FUNCTION. `watch_options.added_price`
 * is write-once at a contract's FIRST-EVER probe — /api/watch upserts on
 * ticker+expiry+strike+side and only writes the mark when the row is NEW — so a
 * strike already in the watch pipeline from an earlier day keeps that day's mark
 * forever. A re-flagged pick charted today then read as a huge loss it never
 * took: PLTR 250814 180C carried a 1.72 basis from a 3-DTE probe while the
 * session it was re-flagged in never traded above ~1.00, printing −80% on a card
 * whose slot stamp said 10:30 AM.
 *
 * The server's `computeResults()` already anchors `entry` to the first snapshot
 * at or after the slot the pick was first flagged THAT DAY. `entryById` carries
 * exactly that value. `added_price` survives only as the fallback for a pick the
 * scorecard has no row for. Card and scorecard therefore cannot disagree about
 * the same contract.
 */
export function derivePickCard(args: {
  row: Row
  slot: string
  /** The `date` the feed reported, for the capture stamp. `""` before it lands. */
  date: string
  index: ScorecardIndex
  hist: PickHist | undefined
}): PickCardView {
  const { row, slot, date, index, hist } = args
  const wid = row.watch_id
  const points = hist?.points ?? []

  const entry =
    (wid != null ? index.entryById.get(wid) : undefined) ?? hist?.contract?.added_price ?? null

  const res = (wid != null ? index.resultById.get(wid) : undefined) ?? null
  const entryTs = res?.entry_ts ?? null

  // C99 — the scorecard is the source of truth. The scan below exists only for a
  // pick it has no row for yet (freshly triggered, results not loaded) so a
  // brand-new live card still says something.
  let peakMark = res?.max_mark ?? null
  let peakTs = res?.max_ts ?? null
  if (peakMark == null) {
    for (const p of points) {
      if (p.mark == null || !Number.isFinite(p.mark)) continue
      // Never count a mark from before the flag.
      if (entryTs != null && p.ts < entryTs) continue
      if (peakMark == null || p.mark > peakMark) {
        peakMark = p.mark
        peakTs = p.ts
      }
    }
  }

  // C100 — `entry === 0` is guarded, so there is no division by zero.
  const peakPct =
    res?.max_pct ??
    (entry != null && entry !== 0 && peakMark != null ? ((peakMark - entry) / entry) * 100 : null)
  // C101 — computed from `peakMark`, which MAY be the client fallback, unlike the
  // table's $/ct (C83) which is strictly `r.max_mark`.
  const peakDollars = entry != null && peakMark != null ? (peakMark - entry) * 100 : null

  // C103 — TWO INDEPENDENT reverse scans. The timestamp can therefore come from a
  // LATER point than the mark, when the newest snapshot has a null mark. And
  // because `points` is RTH-filtered at fetch time, "now" means "the last RTH
  // snapshot", not wall-clock now.
  const reversed = [...points].reverse()
  const lastMark = reversed.find((p) => p.mark != null)?.mark ?? null
  const lastTs = reversed.find((p) => Number.isFinite(p.ts))?.ts ?? null
  const pnlPct =
    entry != null && entry !== 0 && lastMark != null ? ((lastMark - entry) / entry) * 100 : null

  return {
    cid: cardId(row, slot),
    renderKey: cardRenderKey(row),
    wid,
    side: deriveSide(row),
    up: deltaIsUp(row.latest_chg),
    otmPct: otmPctFor(row),
    entry,
    entryTs,
    peakMark,
    peakTs,
    peakPct,
    peakDollars,
    lastMark,
    lastTs,
    pnlPct,
    // C105 — for a LIVE card the slot IS the minute it crossed, so the fallback
    // is meaningful rather than a placeholder.
    trigLabel: entryTs != null ? fmtClock(entryTs) : slotLabel(slot).replace(' ET', ''),
    underFloor: wid != null && index.cheapIds.has(wid),
    grade: gradeFor(wid != null ? index.resultById.get(wid) : null),
    captured: capturedLabel(date, slot),
    points,
  }
}

/**
 * C107 — the tile's `title=`. A row with no `watch_id` has no tooltip at all,
 * because it is also not clickable.
 */
export function cardTitle(row: Row, side: 'C' | 'P', wid: number | null, isFlipped: boolean): string | undefined {
  if (wid == null) return undefined
  return isFlipped ? CARD_BACK_TO_PICK : `Chart ${row.symbol} ${fmtStrike(row.strike)}${side}`
}

/**
 * C15, C49 — every card on the page that CAN be flipped, i.e. was auto-probed.
 * Drives "Flip all" and the while-open refresh. Cards with a null `watch_id` are
 * excluded from the count in the button's label.
 */
export function flippableCards(slots: readonly SlotBucket[]): { cid: string; wid: number }[] {
  const out: { cid: string; wid: number }[] = []
  for (const hb of slots) {
    for (const r of hb.rows) {
      if (r.watch_id != null) out.push({ cid: cardId(r, hb.slot), wid: r.watch_id })
    }
  }
  return out
}

/** C158 — the projection footnote renders only when at least one row was projected. */
export function anyProjected(slots: readonly SlotBucket[]): boolean {
  return slots.some((hb) => hb.rows.some((r) => r.proj_grade))
}

/**
 * The ORDERED field set of the card's FRONT face (C109–C124), by C row.
 *
 * `capture` (C109/C110) and `logo` (C124) are absent on purpose — see the
 * REMOVED block at the top of this file.
 */
export const CARD_FRONT_FIELDS = [
  'rank', // C111 — rendered inside the symbol span, 6px apart, same ink
  'symbol', // C111
  'strike', // C112 — top right
  'delta', // C113 — the headline, fmtBig(latest_chg)
  'grade', // C114 — GradePill at the larger size
  'expirySpot', // C115 — "{expiry} · spot {n}"
  'captured', // C116 — "captured Jul 30 · 10:30 AM ET"
  'otm', // C117 — omitted entirely when spot is null/≤0
  'pctOpen', // C118 — the span renders even when null
  'score', // C119 — server-computed; "score —" when null
  'projGrade', // C120 — renders nothing when proj_grade is null (the default)
  'veryStrong', // C121 — every card carries it; there is no second tier
  'underFloorBadge', // C122 — only when underFloor
  'priceLineHint', // C123 — only when watch_id != null
] as const

/**
 * The ORDERED field set of the card's BACK face (C125–C138), by C row.
 *
 * `capture` (C127's 📷 half) is absent on purpose — see the REMOVED block. The
 * `×` close button (C128) stays: it is the flip control, not a capture control.
 */
export const CARD_BACK_FIELDS = [
  'symbol', // C126
  'sideBadge', // C126 — "{strike}{side}", coloured by the CARD's derived side
  'close', // C128 — the "×"
  'subLine', // C129 — "{expiry} · {captured}"
  'peakHeadline', // C130 — "▲ 142.9%", ONE decimal, glyph carries the sign
  'peakLabel', // C131 — the word "peak"
  'grade', // C132 — GradePill at the default size
  'inHigh', // C133 — "in {entry} {trig} → high {peak} {peakTs} · +$N/ct"
  'now', // C134 — demoted, at 0.7 opacity
  'range', // C135 — the "1D" pill. NOT a control; there is exactly one range
  'metric', // C136 — Price / Net GEX, one state for the whole tab
  'chart', // C137 — loading / error / PickChart, in that order
  'chartHint', // C138 — restates C133 in one line for a cropped screenshot
] as const

/** C130 — "▲ 142.9%" / "▼ 71.4%". ONE decimal, and the glyph carries the sign. */
export function fmtPeakHeadline(peakPct: number | null): string {
  if (peakPct == null) return EM_DASH
  return `${peakPct >= 0 ? '▲' : '▼'} ${Math.abs(peakPct).toFixed(1)}%`
}

/** C134 — the "now" line's percent clause: " · +12%" / " · −7%". U+2212, zero decimals. */
export function fmtNowPct(pnlPct: number): string {
  return ` · ${pnlPct >= 0 ? '+' : '−'}${Math.abs(pnlPct).toFixed(0)}%`
}

/** C133 — the "$/ct" clause on the card back: " · +$412/ct". U+2212 for negatives. */
export function fmtPeakDollarsClause(peakDollars: number): string {
  return ` · ${peakDollars >= 0 ? '+' : '−'}$${Math.abs(peakDollars).toFixed(0)}/ct`
}

/** C118 — "+34% vs open" / "—". Zero decimals. */
export function fmtPctOpen(pctOpen: number | null): string {
  return pctOpen == null ? EM_DASH : `${pctOpen >= 0 ? '+' : ''}${pctOpen.toFixed(0)}% vs open`
}

/** C119 — "score 84" / "score —". Server-computed; see SCORE_LEGEND. */
export function fmtScore(score: number | null): string {
  return `score ${score == null ? EM_DASH : score.toFixed(0)}`
}

/** C117 — "OTM 3.4%", one decimal. The caller omits the span entirely when null. */
export function fmtOtm(otmPct: number): string {
  return `OTM ${otmPct.toFixed(1)}%`
}

/**
 * C138 — the chart hint, which restates C133 in one line so a cropped
 * screenshot of the chart still carries the entry and the peak.
 */
export function chartHint(v: {
  metric: Metric
  entry: number | null
  trigLabel: string
  peakMark: number | null
  peakTs: number | null
  lastTs: number | null
}): string {
  const head = v.metric === 'mark' ? 'price (mark)' : 'net gex @ strike'
  const peakStamp = v.peakTs != null ? ` ${fmtClock(v.peakTs)}` : ''
  return `${head} · RTH · in ${fmtPx(v.entry)} ${v.trigLabel} · high ${fmtPx(v.peakMark)}${peakStamp} · ${ago(v.lastTs)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// THE BACK FACE'S CHART — THE MATHS ONLY (C141–C149)
//
// The pixel geometry is step 3's; see the REMOVED block at the top. What is here
// is what a rewrite would get subtly wrong.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C141 — the plotted series for one metric. Points arrive already RTH-filtered
 * (C10), so this only drops nulls and non-finites.
 */
export function pickSeries(points: readonly PickPoint[], metric: Metric): { ts: number; v: number }[] {
  const out: { ts: number; v: number }[] = []
  for (const p of points) {
    const v = metric === 'mark' ? p.mark : p.net_gex
    if (v == null || !Number.isFinite(v)) continue
    out.push({ ts: p.ts, v })
  }
  return out
}

/** C147 — below this many plotted samples the chart is replaced by its empty state. */
export const MIN_CHART_POINTS = 2

/**
 * C142 — the entry baseline is included in the y domain when it is drawn, so it
 * is always visible on Price. Never on Net GEX, where an option mark means
 * nothing against a gamma figure.
 */
export function showEntryLine(metric: Metric, entry: number | null): boolean {
  return metric === 'mark' && entry != null && Number.isFinite(entry)
}

/** C142 — the padding applied to BOTH ends of the y domain. */
export const Y_PAD_FRACTION = 0.08

/**
 * C142 — the padded y domain. A flat series (min === max) is widened by ±1
 * BEFORE the 8% padding, so a constant line sits in the middle of the box
 * instead of collapsing onto an edge.
 */
export function yDomain(values: readonly number[], entry: number | null): { minY: number; maxY: number } {
  const dom = entry != null && Number.isFinite(entry) ? [...values, entry] : [...values]
  let minY = Math.min(...dom)
  let maxY = Math.max(...dom)
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }
  const pad = (maxY - minY) * Y_PAD_FRACTION
  return { minY: minY - pad, maxY: maxY + pad }
}

/**
 * C144 — THREE gridlines: bottom, middle, top.
 *
 * CODE-VS-COMMENT CONFLICT: v2's `PickChart` doc comment says the chart has
 * "5 gridlines with left-hand value ticks", inherited from the owner Probe page
 * it was ported from. The code maps `[0, 0.5, 1]` and draws three. THE CODE
 * WINS — three is what is on screen.
 */
export const Y_TICK_FRACTIONS: readonly number[] = [0, 0.5, 1]

/** C144 — the y tick label format. Net GEX takes the `$` form; Price is bare 2dp. */
export function chartValueLabel(v: number, metric: Metric): string {
  return metric === 'net_gex' ? fmtGex(v) : v.toFixed(2)
}

/**
 * C149 — more than five minutes from the scorecard's peak timestamp is a
 * DIFFERENT event, and the marker is not drawn at all rather than pointed at the
 * wrong bar.
 */
export const PEAK_MARKER_MAX_MS = 5 * 60_000

/**
 * C149 — the index of the charted sample nearest `peakTs`, or null.
 *
 * NEAREST, NOT EXACT, on purpose: the scorecard reads `watch_snapshots` straight
 * while these points are RTH-filtered client-side, so the two series can be off
 * by a sample. Callers pass `peakTs = null` for Net GEX, where a "high" means
 * nothing.
 */
export function nearestIndexToTs(
  series: readonly { ts: number }[],
  peakTs: number | null,
): number | null {
  if (peakTs == null || !Number.isFinite(peakTs)) return null
  let best = Infinity
  let idx: number | null = null
  for (let i = 0; i < series.length; i++) {
    const p = series[i]
    if (!p) continue
    const d = Math.abs(p.ts - peakTs)
    if (d < best) {
      best = d
      idx = i
    }
  }
  return best > PEAK_MARKER_MAX_MS ? null : idx
}

/**
 * C145 — the x-axis time labels.
 *
 * // BUG (v2): this is the BROWSER's locale and the BROWSER's timezone — an empty
 * // locale array and NO `timeZone` option — while `fmtClock` (C25) pins ET. For
 * // a viewer outside New York the chart's axis and the "high @ 1:42 PM" stamp
 * // directly above it name different times for the same sample. Transcribed as
 * // written; step 3 decides whether the axis moves to ET or the stamp moves to
 * // local, but they must not stay split.
 */
export function chartTimeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY — every user-visible string on this tab, so step 3 cannot paraphrase one
// ─────────────────────────────────────────────────────────────────────────────

/** C44 — the card title. Separator is U+00B7. */
export const CARD_TITLE = 'GEX Change · Hourly Top 5'

/**
 * C45 — the card subtitle.
 *
 * Note this writes the ★ rule with `&` where the footer legend (C155) writes the
 * same rule with `AND`. Both are on screen at once. Copied as-is.
 *
 * INK: v2 painted this `HOME_THEME.green` #8ECAE6, the positive/up value. It is
 * chrome — a subtitle — so it takes `T.muted` in v3. See the CHROME paragraph in
 * §SIGN COLOURS.
 */
export const CARD_SUBTITLE =
  '★ Very strong picks (|Δ| ≥ $200k & |% vs open| ≥ 30%), ranked by score · captured every 30 min during RTH'

/**
 * C45 — the ONLY loading affordance once data is already on screen. Single U+2026.
 */
export const SUBTITLE_REFRESHING_SUFFIX = ' · refreshing…'

/** C45 — the subtitle with the refresh suffix appended while a slot load is in flight. */
export function cardSubtitle(loading: boolean): string {
  return `${CARD_SUBTITLE}${loading ? SUBTITLE_REFRESHING_SUFFIX : ''}`
}

/** C48 — the toolbar's refresh button. */
export const REFRESH_LABEL = 'Refresh'

/** C49 — "⟳ Flip all (12)", or "⟲ Flip back" when every flippable card is over. */
export function flipAllLabel(flippableCount: number, allFlipped: boolean): string {
  if (allFlipped) return '⟲ Flip back'
  return `⟳ Flip all${flippableCount ? ` (${flippableCount})` : ''}`
}

/** C49 — the flip-all button's `title=`, both states. */
export const FLIP_ALL_TITLE_FLIP = 'Turn every probed card over to its price line'
export const FLIP_ALL_TITLE_BACK = 'Turn every card back to the pick'

/** C50 — the toolbar hint. */
export const TOOLBAR_HINT = 'click a card for its option price line'

/** C54 — the scorecard heading. */
export const SCORECARD_TITLE = 'Scorecard'

/**
 * C55 — the freshness pill. NOT a button: v2 gives it no click handler and forces
 * `cursor: default`. `frozen` defaults to false, so a failed `/results` load
 * shows the LIVE wording.
 */
export const SCORECARD_FROZEN_LABEL = 'EOD · final'
export const SCORECARD_LIVE_LABEL = 'live · peak so far'

/** C55 — the freshness pill's text. */
export function scorecardFreshnessLabel(frozen: boolean): string {
  return frozen ? SCORECARD_FROZEN_LABEL : SCORECARD_LIVE_LABEL
}

/** C57 — "12 picks" / "1 pick". */
export function picksLabel(n: number): string {
  return `${n} pick${n === 1 ? '' : 's'}`
}

/** C57 — the filter basis, in parentheses after the pick count. */
export function scorecardBasisLabel(scoreCheap: boolean): string {
  return scoreCheap ? 'all entries' : `entry > $${ENTRY_FLOOR.toFixed(2)}`
}

/** C58–C62 — the summary line's five labels, in render order. */
export const SUMMARY_LABELS = {
  avgPeak: 'avg peak',
  hit25: '≥+25%',
  hit50: '≥+50%',
  hit100: '≥+100%',
  greenClose: 'closed green',
} as const

/** C63 — the cheap-entry toggle, both states. Only rendered when `cheapCards > 0 || scoreCheap`. */
export function cheapToggleLabel(scoreCheap: boolean, cheapCards: number): string {
  return scoreCheap
    ? `exclude ≤ $${ENTRY_FLOOR.toFixed(2)}`
    : `score ≤ $${ENTRY_FLOOR.toFixed(2)} too (${cheapCards})`
}

/** C63 — the cheap-entry toggle's `title=`. */
export function cheapToggleTitle(cheapCards: number): string {
  return `${cheapCards} card${cheapCards === 1 ? '' : 's'} on this date entered at $${ENTRY_FLOOR.toFixed(2)} or less. Their % moves are tick-size artifacts, so they are left out of the ranking and the averages by default.`
}

/**
 * C65 — the scorecard show/hide toggle. Default is SHOWN.
 *
 * Hiding suppresses the grades strip, the empty state and the table. It does NOT
 * suppress the title, the freshness pill, the summary line, the toggles or the
 * error line.
 */
export function showResultsLabel(showResults: boolean): string {
  return showResults ? 'Hide' : 'Show'
}

/** C67 — the grade-distribution strip's leading label. */
export const GRADES_LABEL = 'Grades'

/** C69 — the GPA label. */
export const GPA_LABEL = 'avg'

/**
 * C69 — "84/100".
 *
 * THE `gpa == null → "—"` BRANCH IS UNREACHABLE and is kept anyway. The whole
 * distribution strip is gated on `graded.length > 0` (C.G), and `gpa` is
 * `graded.length ? … : null` — so by construction every render that can reach
 * this function has a number for it. Spec row C69 and "Do not port" item 11 call
 * the branch out as dead; it is transcribed rather than dropped because deleting
 * it would move a null check out of this file and into whatever calls it, and the
 * gate that makes it dead is in step 3's code, not here. If step 3 ever renders
 * the GPA outside that gate, the em dash is already the right answer.
 */
export function fmtGpa(gpa: number | null): string {
  return gpa == null ? EM_DASH : `${gpa.toFixed(0)}/100`
}

/** C70 — the never-green label, its value format and its tooltip. */
export const NEVER_GREEN_LABEL = 'never green'
export function fmtNeverGreen(neverGreen: number, neverGreenPct: number | null): string {
  return `${neverGreen}${neverGreenPct != null ? ` (${neverGreenPct.toFixed(0)}%)` : ''}`
}
export const NEVER_GREEN_TITLE =
  'Picks whose best post-flag mark never printed above the entry — they went straight to red and stayed there.'

/** C71 — the scorecard error line. Rendered regardless of the show/hide state. */
export function scorecardErrorLabel(resErr: string): string {
  return `Scorecard error: ${resErr}`
}

/** C72 — the empty state when `/results` returned no rows at all. */
export const SCORECARD_EMPTY_NO_ROWS =
  'No scored picks for this date yet — rows appear once picks have been auto-probed and snapshots start landing.'

/**
 * C72 — the empty state when rows exist but none clear the floor.
 *
 * VERBATIM FROM v2, INCLUDING ITS ERROR. The curly quotes are U+201C/U+201D and
 * the button it names — "show ≤ $0.50" — DOES NOT EXIST: the real toggle reads
 * "score ≤ $0.50 too (N)" (C63) and only renders at all when `cheapCards > 0 ||
 * scoreCheap`, so the copy can point at nothing. Spec row C72 says to fix the
 * string in the port; `SCORECARD_EMPTY_BELOW_FLOOR_FIXED` below is that fix,
 * left as a separate export so step 3 makes the swap deliberately rather than
 * inheriting a paraphrase.
 */
export const SCORECARD_EMPTY_BELOW_FLOOR = `No picks above the $${ENTRY_FLOOR.toFixed(2)} entry floor for this date — use “show ≤ $${ENTRY_FLOOR.toFixed(2)}” above to include them.`

/** C72 — the corrected wording, naming the toggle that actually exists. */
export const SCORECARD_EMPTY_BELOW_FLOOR_FIXED = `No picks above the $${ENTRY_FLOOR.toFixed(2)} entry floor for this date — use “score ≤ $${ENTRY_FLOOR.toFixed(2)} too” above to include them.`

/** C72 — which empty state applies. */
export function scorecardEmptyCopy(totalResults: number): string {
  return totalResults === 0 ? SCORECARD_EMPTY_NO_ROWS : SCORECARD_EMPTY_BELOW_FLOOR
}

/**
 * C74–C86 — the twelve column headers, in render order, with their alignment.
 *
 * There is NO sort on any of them: no key, no default column, no direction, no
 * comparator, no tie-break and no click handler. See point 7 in the file header.
 *
 * INK, and it is a change: v2 painted every one of these headers
 * `HOME_THEME.green` #8ECAE6 — the same value as a positive Peak %. They are
 * chrome, so they take `T.muted` in v3. See the CHROME paragraph in §SIGN
 * COLOURS. The `key` field is an identity for the render, NOT a sort key; adding
 * a comparator keyed off it would invent an order the server never promised.
 */
export const SCORECARD_COLUMNS: readonly { key: string; label: string; align: 'left' | 'right' }[] = [
  { key: 'grade', label: 'Grade', align: 'left' }, // C74/C75
  { key: 'symbol', label: 'Symbol', align: 'left' }, // C76
  { key: 'contract', label: 'Contract', align: 'left' }, // C77
  { key: 'flagged', label: 'Flagged', align: 'left' }, // C78
  { key: 'entry', label: 'Entry', align: 'right' }, // C79
  { key: 'peak', label: 'Peak', align: 'right' }, // C80
  { key: 'peakAt', label: 'Peak at', align: 'left' }, // C81
  { key: 'peakPct', label: 'Peak %', align: 'right' }, // C82
  { key: 'perContract', label: '$/ct', align: 'right' }, // C83
  { key: 'close', label: 'Close', align: 'right' }, // C84
  { key: 'closePct', label: 'Close %', align: 'right' }, // C85
  { key: 'lowPct', label: 'Low %', align: 'right' }, // C86 — NEVER coloured
]

/** C87 — the table footnote. Disappears with the table, so it is not shown under the empty state. */
export const SCORECARD_FOOTNOTE =
  'Entry = the auto-probe mark at the slot the strike was first flagged. Peak / Low / Close are measured from that entry, over snapshots taken after it — the best exit that was actually on offer, not a fill.'

/** C88 — the feed error line. Rendered even while `loading` is true, and it suppresses C89. */
export function feedErrorLabel(err: string): string {
  return `Error: ${err}`
}

/** C6, C8 — the error text a non-`ok` response falls back to. */
export const LOAD_FAILED = 'load failed'

/** C10 — the error text a non-`ok` history response falls back to. */
export const NO_HISTORY = 'no history'

/** C89 — the first-paint / loading word. Single U+2026. */
export const LOADING_LABEL = 'Loading…'

/** C89 — the no-slots state. */
export const NO_SLOTS_COPY =
  'No very-strong picks recorded yet for this date. The recorder files a strike the minute it crosses into ★ Very strong, and captures the top 5 every 30 min during RTH.'

/** C89 — which no-slots copy applies. */
export function noSlotsCopy(loading: boolean): string {
  return loading ? LOADING_LABEL : NO_SLOTS_COPY
}

/**
 * C93 — the live-trigger badge and its tooltip.
 *
 * A live section is a CROSSING, not a leaderboard: it usually holds one or two
 * cards, and the badge is the only thing that stops that reading as four missing
 * picks.
 */
export const LIVE_TRIGGER_BADGE = '⚡ LIVE TRIGGER'
export const LIVE_TRIGGER_TITLE =
  "Filed the minute this strike crossed into ★ Very strong, by the recorder's 60s trigger scan — not a scheduled top-5 capture."

/** C121 — every card on this tab carries this; there is no second tier. */
export const VERY_STRONG_LABEL = '★ Very strong'

/** C122 — the under-floor badge on a legacy card. */
export const UNDER_FLOOR_BADGE = `≤ $${ENTRY_FLOOR.toFixed(2)} · unscored`

/**
 * C122 — the under-floor badge's `title=`.
 *
 * The `?? 0` is v2's: a missing entry would render "Entered at $0.00". In
 * practice `underFloor` implies the id is in `cheapIds`, which implies an entry
 * exists — so the fallback is unreachable and is copied rather than removed.
 */
export function underFloorTitle(entry: number | undefined): string {
  return `Entered at $${(entry ?? 0).toFixed(2)} — at or under the $${ENTRY_FLOOR.toFixed(2)} floor, so it is left out of the scorecard ranking and averages.`
}

/** C123 — the flip affordance on the front face. */
export const PRICE_LINE_HINT = '▸ price line'

/** C115 — "spot" precedes `fmtSpot`. */
export const SPOT_LABEL = 'spot'

/** C116 — "captured" precedes `capturedLabel`. */
export const CAPTURED_LABEL_PREFIX = 'captured'

/** C128 — the back face's close glyph (U+00D7) and its tooltip. */
export const CARD_CLOSE_GLYPH = '×'
export const CARD_BACK_TO_PICK = 'Back to the pick'

/** C131, C133, C134 — the back face's four inline labels. */
export const BACK_LABELS = {
  peak: 'peak',
  in: 'in',
  high: 'high',
  now: 'now',
  arrow: '→',
} as const

/** C135 — the range pill. NOT a control: the recorder's snapshots are one session. */
export const RANGE_PILL_LABEL = '1D'

/** C137 — the chart's loading line. Requires `!points.length`, so a refresh over
 *  existing points keeps the chart on screen instead of blanking it. */
export const CHART_LOADING = 'loading history…'

/** C147 — the "too short to plot" state, on two lines. */
export const CHART_EMPTY_LINE_1 = 'not enough history yet —'
export const CHART_EMPTY_LINE_2 = 'snapshots accrue every minute through RTH'

// ─────────────────────────────────────────────────────────────────────────────
// THE FOOTER LEGEND (C154–C158)
//
// THESE FOUR STRINGS ARE DISPLAY COPY DESCRIBING SERVER BEHAVIOUR. THEY ARE NOT
// CLIENT LOGIC AND THEY DO NOT DESCRIBE ANY CODE IN THIS FILE.
//
// The ranking formula (0.6 on |Δ|, 0.4 on |% vs open|, normalised 0–100) and the
// ★ Very strong flag ($200k on |Δ| AND 30% on |% vs open|, both inclusive) exist
// in v2 ONLY as the two label strings below. `row.score` and the ★ tier arrive
// already computed from server-v2/gex-change-top-recorder.js; a grep of the
// whole v2 `components/` and `lib/` tree finds no second copy of `200_000`,
// `0.6`, or the word "Very strong" outside these labels.
//
// The weights and thresholds are therefore NOT exported as numbers. Exporting
// them would invite step 3 to filter or rank with them, which would put a second
// implementation of the recorder's rule on the client — and a client that
// disagreed with the server about which picks are ★ would be worse than one that
// simply reports what it was sent. If v3 ever needs the numbers, it needs a
// server field, not a constant here.
// ─────────────────────────────────────────────────────────────────────────────

/** C154 — U+00B7 for the multiplication dots, U+2013 in "0–100". */
export const SCORE_LEGEND = 'Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100'

/**
 * C155 — rendered as two pieces because "★ Very strong" is its own coloured
 * span. Both boundaries are U+2265. Restates the card subtitle (C45), which
 * writes the same rule with `&` instead of `AND`.
 */
export const STAR_LEGEND_LEAD = '★ Very strong'
export const STAR_LEGEND_TAIL = ' = |Δ| ≥ $200k AND |% vs open| ≥ 30%'
export const STAR_LEGEND = `${STAR_LEGEND_LEAD}${STAR_LEGEND_TAIL}`

/** C156 — describes the recorder's POST /api/watch → watch_options + 60s snapshot loop. */
export const AUTO_PROBE_LEGEND =
  'Every pick is auto-probed at capture — the flip side is its recorded option price since it was flagged'

/**
 * C157 — rendered as three pieces because the "F" is its own coloured span.
 *
 * The three maxima match the ladder exactly (55 + 25 + 20 = 100). The never-green
 * clause matches `gradeFor`'s LOCAL path only — the server path does not apply
 * it. See the `// BUG (v2):` note in `gradeFor`.
 */
export const GRADE_LEGEND_LEAD =
  'Grade = 55 pts peak (best gain offered) + 25 pts pain (worst drawdown) + 20 pts close. '
export const GRADE_LEGEND_F = 'F'
export const GRADE_LEGEND_TAIL =
  ' is automatic when a pick never traded green, whatever the rest of the row says.'
export const GRADE_LEGEND = `${GRADE_LEGEND_LEAD}${GRADE_LEGEND_F}${GRADE_LEGEND_TAIL}`

/**
 * C158 — the only cross-reference to Part D on this tab. Rendered as two pieces
 * because "proj" is bold. Gated on `anyProjected(slots)`, which is false
 * whenever no projection rule is armed — the shipping default.
 */
export const PROJ_LEGEND_LEAD = 'A dashed '
export const PROJ_LEGEND_BOLD = 'proj'
export const PROJ_LEGEND_TAIL =
  ' pill is what the projection rule predicted at capture — see the Pick Study tab for whether those predictions are holding up.'
export const PROJ_LEGEND = `${PROJ_LEGEND_LEAD}${PROJ_LEGEND_BOLD}${PROJ_LEGEND_TAIL}`
