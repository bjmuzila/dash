import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/spx — SPX candles with the GEX bubbles over them.
//
// It IS the home board's `gex-candles` card. That card is already phone-aware
// (it calls useIsPhone() and folds its toolbar into a bottom sheet), and it
// carries the SPX/ES TAPE SWITCH — cash index vs the front-month future, with
// the same SPX gamma drawn over either one, every strike shifted by the ES−SPX
// basis. The switch sits in the header on a phone as well as on the desktop, so
// it is one tap from here rather than a tap into a sheet.
//
// `spxOnly` (2026-09-03) does two things, and they are the same thing: the card
// stops following the board's ticker and charts SPX — which makes that SPX/ES
// switch the only symbol control on the screen — and SESSION STOPS BEING A
// SETTING, because ES is ETH and SPX cash is RTH and there was never a fourth
// combination worth a button. See the prop.
//
// The tab is called SPX rather than ES because the cash index is what it opens
// on; the future is the switch.

const GexCandlesCard = lazy(() =>
  import('@/board/gexCandles/GexCandlesCard').then((m) => ({ default: m.GexCandlesCard })),
)

export default function MSpx() {
  return (
    <MobileShell title="Candles" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <GexCandlesCard spxOnly />
      </Suspense>
    </MobileShell>
  )
}
