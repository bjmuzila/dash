import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/em — the weekly estimated move and its zones.
//
// The v3 page, unchanged. It is already a single 720px-max column that scrolls,
// which is a phone layout that happens to also work on a desktop, and it carries
// its OWN ticker box — so the shell adds no header and no symbol control here.
// Both would be a second way to set the same thing.

const Em = lazy(() => import('@/pages/Em'))

export default function MEm() {
  return (
    <MobileShell chrome="bare">
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <Em />
      </Suspense>
    </MobileShell>
  )
}
