// ─────────────────────────────────────────────────────────────────────────────
// ALIGN · MAIN — /scanner?tab=alignmain.
//
// The Align tab narrowed to the scanner roster's MAIN (hot) lane: SPY, QQQ, SPX,
// NDX, VIX and the mega-caps. Same model, same settings (shared with Align), same
// drill-in; two differences, both in AlignTab's `universe="main"` branch:
//
//   1. Every MAIN ticker is shown. Rows that fail distance / dominance are
//      dimmed, not hidden — with fourteen names a missing row reads as a bug.
//   2. The request carries `focus=hot`, so the server keeps the ALL ex-0DTE wall
//      swept for all fourteen, not only the ones whose walls already agree.
//
// The universe is the watchlist's `hot` flag (owner Watchlists page), falling
// back to SCANNER_MAIN in data/scannerTickers.ts on a server that sends no flag.
// Its own file so the scanner registry keeps one lazy chunk per tab.
// ─────────────────────────────────────────────────────────────────────────────

import AlignTab from '@/pages/scanner/AlignTab'

export default function AlignMainTab() {
  return <AlignTab universe="main" />
}
