// ─────────────────────────────────────────────────────────────────────────────
// THE SCANNER TAB REGISTRY.
//
// Transcribed 1:1 from v2's `components/scanner/scannerNav.ts` against the
// checklist in docs/parity/scanner.md Part A, rows A23a–A29.
//
// Four things here are not obvious from the screen:
//
//   1. `ownerOnly` is CHROME, not a security boundary. It decides what gets
//      drawn. A hidden tab is one devtools poke away from visible, so anything
//      that must not leak needs a server-side gate on its data route too. v2's
//      own JSDoc says this and it is repeated here because the flag looks like
//      an ACL and is not one.
//   2. `short` exists because the rail strip must fit on one line. It falls
//      back to `label`; that fallback is why `ibstats` carries a `short` equal
//      to its `label` rather than omitting it — v2 wrote it out, and a reader
//      comparing the two files should not have to work out whether that was
//      deliberate. It was not, but it is harmless and copying it keeps the diff
//      honest.
//   3. Every tab appears in exactly ONE group. A stale key in `SCANNER_GROUPS`
//      is harmless (the renderer skips an unknown id); a stale entry in
//      `SCANNER_TABS` still draws a pill. Remove from both.
//   4. The accent per tab is a real product decision (GEX Levels and Strike
//      Query share one; IB Stats and Watch share another), so it is kept — but
//      as tokens, never as the v2 hex.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// v2 had TWO answers for the default tab: `ScannerPage`'s `useState` said
// "gexchangetop" and `sectionNav.ts`'s `SCANNER_SECTION.defaultTab` said
// "gexlevels". On a bare /scanner the strip highlighted GEX Levels while GEX
// Change Top was rendered. There is one constant here, `DEFAULT_TAB`, and both
// the page and the strip read it. Recorded in docs/parity/scanner.md finding 1.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `scannerTabHref()` and `emitScannerTab()` / `SCANNER_TAB_EVENT`. The event
//   existed because v2's strip navigated to `/scanner?tab=…`, and React Router
//   does not remount for a query-string-only change — so the URL moved and the
//   visible tab did not. v3 puts the tab in the query string as the SOURCE of
//   truth (`useSearchParams`), which the page observes directly. A custom
//   window event to paper over the router is not needed and would be a second,
//   unvalidated way in: v2's listener cast any truthy `detail` to a tab id with
//   no `isScannerTabId` guard, so a malformed event rendered a page with no
//   card at all, silently.
// • `SCANNER_ROUTES` (`/level-log`) and `isScannerSectionPath()`. Level Log is
//   its own page and is not part of this port.
// • `readTabFromUrl()`. It read `window.location.search` inside an effect to
//   keep the Next page prerenderable, which cost a one-frame flash of the wrong
//   tab. v3 is a Vite SPA — the router has the param synchronously.
//
// ── DROPPED FROM v3, DO NOT RE-ADD ───────────────────────────────────────────
// • 2026-09-03: 'tpo' — TPO Structures. Brandon dropped the tab. It left THREE
//   places in this file, not one, and note 3 above is why all three had to go:
//   a stale key in `SCANNER_GROUPS` is harmless, but a stale entry in
//   `SCANNER_TABS` STILL DRAWS A PILL — one that selects a tab id with no
//   component behind it. Removing it from `SCANNER_TABS` is what stops the pill;
//   removing it from `ScannerTabId` is what makes the compiler find every other
//   site, because `TAB_COMPONENT` in pages/Scanner.tsx is a
//   `Record<ScannerTabId, …>` and a leftover 'tpo' key is only an error once the
//   union no longer contains it. The union is the enforcement, so it leaves too.
//   `isScannerTabId('tpo')` is now false and a pasted `?tab=tpo` falls back to
//   DEFAULT_TAB, which is the same treatment any other unknown id gets.
//   The tab's modules are tombstoned under pages/scanner/ (TpoTab.tsx,
//   tpoData.ts, tpoStructures.ts, tpoTaxonomy.ts, tpoProfile.ts, amt.ts); the
//   candle loaders they shared with IB Stats live on in pages/scanner/candles.ts.
//
// Spec: docs/parity/scanner.md Part A, rows A12–A29.
// ─────────────────────────────────────────────────────────────────────────────

import { V2 } from '@/design/theme'

/** Tabs that render inline on /scanner. */
export type ScannerTabId =
  | 'gexlevels'
  | 'gexchangetop'
  | 'pickstudy'
  | 'strike'
  | 'ibstats'
  | 'watch'

export interface ScannerTabDef {
  id: ScannerTabId
  /** The full label. What the tab is called in prose and in the page title. */
  label: string
  /** Compact label for the strip, where the whole row must fit one line. */
  short: string
  /** Per-tab accent, as a token. Never a hex. */
  accent: string
  /** Glyph shown in the strip. Matches the rail's emoji icon language. */
  icon: string
  /**
   * Draw the pill for the owner only. CHROME LEVEL — the strip skips it and the
   * page refuses to render it, but this is NOT a security boundary. Anything
   * that must not leak needs a server-side gate on its data route too.
   */
  ownerOnly?: boolean
}

/**
 * Bar order + per-tab accent.
 *
 * v2 accent → v2 token. 2026-09-03: the step-2 collapse onto v3's semantic
 * palette is REVERSED — the scanner renders v2's palette, so every accent below
 * is v2's own value (`V2.cyan` #219EBC, `V2.orange` #FB8501, `V2.purple`
 * #126783), not v3's near-miss equivalents.
 *
 * THIS FILE CARRIES THE ACCENT LEG OF THE THREE-WAY SPLIT. v2's
 * `HOME_THEME.green` #8ECAE6 is a LIGHT BLUE doing three unrelated jobs at once
 * — chrome, this accent, and the positive/up semantic — and that one collision
 * is the only thing the port breaks. The three legs each take a DIFFERENT value
 * v2 already ships:
 *
 *   chrome    #8ECAE6  V2.green   card subtitles, table headers, category badges
 *   accent    #7dd3fc  V2.accent  the IB Stats and Watch This tab pills — HERE
 *   positive  #1FD98A  V2.up      every sign-driven / hit-miss figure
 *
 * The accent leg has v2's own answer behind it: `homeTheme.ts:88` declares
 * `LIGHT_BLUE = "#7dd3fc"` under the comment "the one card accent". Watch This'
 * pill was already that value, and IB Stats' body already accents in it
 * throughout, so this is the pill agreeing with the tab it opens. Note this is
 * NOT v3's `LIGHT_BLUE`, which is `--color-series-5` #4fb8d4.
 *
 * The other three positives on this page (#22c55e, #30d158, #1FD98A) are NOT
 * unified — see the token docblocks in src/design/theme.ts before reaching for
 * a green anywhere on the scanner.
 *
 * 2026-08-16 (v2): "gex", "gexpct", "marketquality" and "statprompter" moved to
 * Test Lab and "gexlevels" came the other way. Those four are not in this list
 * and are not part of this port.
 */
export const SCANNER_TABS: readonly ScannerTabDef[] = [
  { id: 'gexlevels', label: 'GEX Levels', short: 'Levels', accent: V2.cyan, icon: '📏' },
  { id: 'gexchangetop', label: 'GEX Change Top', short: 'GEX Δ Top', accent: V2.orange, icon: '📊' },
  // Sits next to GEX Change Top because it is that tab's feedback loop: the
  // cards flag picks, the scorecard grades them, this reads the graded history
  // back and asks what the A/B picks had in common at capture.
  //
  // OWNER ONLY (v2, 2026-08-21): the tuning bench for the pick ranking —
  // half-formed splits, thin buckets, and a calibration block that reads "not
  // armed" most of the time. Research in progress, not a customer view.
  {
    id: 'pickstudy',
    label: 'Pick Study',
    short: 'Study',
    accent: V2.purple,
    icon: '🔬',
    ownerOnly: true,
  },
  { id: 'strike', label: 'Strike Query', short: 'Strike', accent: V2.cyan, icon: '🎯' },
  { id: 'ibstats', label: 'IB Stats', short: 'IB Stats', accent: V2.accent, icon: '📐' },
  { id: 'watch', label: 'Watch This', short: 'Watch', accent: V2.accent, icon: '👁️' },
]

/**
 * THE default tab — one constant, read by the page AND the strip. v2 had two
 * and they disagreed. See the departure note at the top.
 */
export const DEFAULT_TAB: ScannerTabId = 'gexchangetop'

/**
 * Clusters for the strip, left → right, separated by hairline dividers. Every
 * tab appears in exactly one cluster.
 *
 * There is no "overview" tab: the strip is always on screen inside the Scanner
 * section, so a landing page whose only job was linking to the other tabs had
 * nothing left to do.
 */
export const SCANNER_GROUPS: readonly { key: string; tabs: readonly ScannerTabId[] }[] = [
  { key: 'gamma', tabs: ['gexlevels', 'gexchangetop', 'pickstudy', 'strike'] },
  // One tab since 2026-09-03 — TPO left. Kept as its own cluster rather than
  // folded into 'gamma': IB Stats is a structure read, not a gamma read, and the
  // divider is what says so.
  { key: 'structure', tabs: ['ibstats'] },
  { key: 'more', tabs: ['watch'] },
]

/**
 * Note this does NOT filter `ownerOnly` — `isScannerTabId('pickstudy')` is true
 * for everyone, exactly as in v2. The owner gate is applied at render, not at
 * parse: a non-owner who pastes ?tab=pickstudy has a valid tab id that they are
 * not shown. Conflating the two would make a bad URL and a forbidden URL
 * indistinguishable.
 */
export function isScannerTabId(v: string | null | undefined): v is ScannerTabId {
  return !!v && SCANNER_TABS.some((t) => t.id === v)
}

/** The tab ids gated behind the owner check. Derived, never hand-listed. */
export const OWNER_ONLY_TABS: ReadonlySet<ScannerTabId> = new Set(
  SCANNER_TABS.filter((t) => t.ownerOnly).map((t) => t.id),
)

/** Look a tab up by id. Returns undefined for an unknown id — callers guard. */
export function scannerTab(id: ScannerTabId): ScannerTabDef | undefined {
  return SCANNER_TABS.find((t) => t.id === id)
}
