import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/heat — the Multi Greek ladder, one column wide.
//
// It IS the home board's `multi-greek` card, with `singleColumn` set. That prop
// pins the ladder to ONE expiry column — the front one, which on SPX is 0DTE —
// and hides the Columns control, because the setting it edits cannot move here.
//
// WHY ONE COLUMN. The card's reason to exist is the ACROSS read: the same strike
// on several symbols at the same DTE. On a 390px screen three expiry columns per
// panel is three unreadable columns and the across read is gone; one column and
// up to four ticker panels is that same read, and it survives the width. The
// ＋ button is untouched, so 1–4 tickers still works exactly as it does on the
// board — the panel row scrolls sideways once there are more than two.
//
// `pinnedFirst="SPX"` (2026-09-03): panel one is SPX and is not typeable. On the
// board that panel IS the page symbol and typing in it moves everything, which
// is honest there; here nothing else reads that value — the toolbar's picker is
// hidden on /m/* — so a typeable panel one would be the last way to move a
// number with no visible consequence. ＋ is the way symbols come in, and it
// ADDS rather than replaces.
//
// `fill` — the ladder scrolls inside itself, both ways. A page that also
// scrolled would fight it.

const MultiGreekCard = lazy(() =>
  import('@/board/multiGreek/MultiGreekCard').then((m) => ({ default: m.MultiGreekCard })),
)

export default function MHeat() {
  return (
    <MobileShell title="Multi Greek" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <MultiGreekCard singleColumn pinnedFirst="SPX" />
      </Suspense>
    </MobileShell>
  )
}
