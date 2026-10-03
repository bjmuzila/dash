import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/vela — the Vela chart workspace on a phone.
//
// It IS pages/Vela.tsx, rendered with `phone`. That prop pins Vela to its own
// touch chrome (one bottom bar, full-screen symbol / timeframe pickers, pinch
// and drag on the plot), to ONE chart, and to its own saved document
// (`cb-v3-vela-m`), while the data provider, the CB Walls study and the
// clipboard camera stay the page's own. A fix to the page is a fix to the phone.
//
// `bare` because Vela draws its own topbar/bottom bar — a card header over it
// would be the doubled bar MobileShell exists to avoid — and `fill` because the
// chart owns every gesture on it: a canvas inside a scrolling column can be
// neither panned nor scrolled reliably.
//
// A PROP, not useIsPhone(): holding the tab for "Desktop site" lands a phone on
// /vela, and that has to render the desktop workspace for the opt-out to mean
// anything.

const Vela = lazy(() => import('@/pages/Vela'))

export default function MVela() {
  return (
    <MobileShell chrome="bare" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <Vela phone />
      </Suspense>
    </MobileShell>
  )
}
