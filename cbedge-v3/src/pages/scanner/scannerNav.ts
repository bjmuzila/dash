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
//      Query share one; TPO and Watch share another), so it is kept — but as
//      tokens, never as the v2 hex.
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
// Spec: docs/parity/scanner.md Part A, rows A12–A29.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, T } from '@/design/theme'

/** Tabs that render inline on /scanner. */
export type ScannerTabId =
  | 'gexlevels'
  | 'gexchangetop'
  | 'pickstudy'
  | 'strike'
  | 'tpo'
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
 * v2 accent → v3 token. The two greens and two light blues collapse here, per
 * the decision in docs/parity/scanner.md: v2's `HOME_THEME.green` #8ECAE6 is a
 * LIGHT BLUE doing three jobs (chrome, this accent, and the positive/up
 * semantic). As an ACCENT it becomes LIGHT_BLUE, the same token TPO and Watch
 * already use; as a positive it becomes MOVE_UP wherever a number is painted.
 * The accent and the "good number" colour were never meant to be the same value.
 *
 * 2026-08-16 (v2): "gex", "gexpct", "marketquality" and "statprompter" moved to
 * Test Lab and "gexlevels" came the other way. Those four are not in this list
 * and are not part of this port.
 */
export const SCANNER_TABS: readonly ScannerTabDef[] = [
  { id: 'gexlevels', label: 'GEX Levels', short: 'Levels', accent: T.cyan, icon: '📏' },
  { id: 'gexchangetop', label: 'GEX Change Top', short: 'GEX Δ Top', accent: T.orange, icon: '📊' },
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
    accent: T.purple,
    icon: '🔬',
    ownerOnly: true,
  },
  { id: 'strike', label: 'Strike Query', short: 'Strike', accent: T.cyan, icon: '🎯' },
  { id: 'tpo', label: 'TPO Structures', short: 'TPO', accent: LIGHT_BLUE, icon: '🏛️' },
  { id: 'ibstats', label: 'IB Stats', short: 'IB Stats', accent: LIGHT_BLUE, icon: '📐' },
  { id: 'watch', label: 'Watch This', short: 'Watch', accent: LIGHT_BLUE, icon: '👁️' },
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
  { key: 'structure', tabs: ['tpo', 'ibstats'] },
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
