import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/chain — the options chain.
//
// This one is a v3 PAGE rather than a board card, and it already draws its own
// toolbar (ticker, expiry, strike window, the cog) in a row that scrolls
// sideways. So the shell is `bare`: no Card, no second header. The one thing the
// page cannot supply for itself on a phone is the BOARD's ticker control — it
// reads usePageSymbol() and the desktop toolbar that sets it is not mounted
// here — so the shell contributes that strip and nothing else.
//
// `fill` — the matrix owns a scroll container of its own and centres the ATM row
// inside it on load. An outer scroll would break that centring.

const OptionsChain = lazy(() => import('@/pages/OptionsChain'))

export default function MChain() {
  return (
    <MobileShell chrome="bare" title="Chain" fill symbol>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <OptionsChain />
      </Suspense>
    </MobileShell>
  )
}
