import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/whales — the $1M+ whale archive.
//
// It IS pages/Whales.tsx, rendered with `phone`. That prop swaps the page's
// arrangement — range/ticker/FILTERS strip, a bottom sheet for the folded
// filters, two-line print rows, PRINTS · SIZE · LOOKUP · TRACKED · DRIFT
// sub-tabs, and the contract probe as a full-height sheet — while the fetch,
// the saved filters, the lookup and the tracked store stay the page's own. A
// fix to the page is a fix to the phone.
//
// `bare` because the page draws its own header, and `fill` because it owns its
// scroll region: the header and the strip stay put while the list scrolls.
//
// A PROP, not useIsPhone(): holding the tab for "Desktop site" lands a phone on
// /whales, and that has to render the desktop layout for the opt-out to mean
// anything.

const Whales = lazy(() => import('@/pages/Whales'))

export default function MWhales() {
  return (
    <MobileShell chrome="bare" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <Whales phone />
      </Suspense>
    </MobileShell>
  )
}
