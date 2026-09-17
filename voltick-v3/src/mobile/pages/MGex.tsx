import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/gex — the GEX profile, phone edition.
//
// It IS the home board's `gex-chart` card (src/board/gexChart/GexChartCard.tsx),
// mounted full-bleed. Not a phone-only copy of it: the card already measures its
// own container, backs its canvas at devicePixelRatio and reports visibility
// through ChartFrame, and a second renderer for the same numbers is the thing
// that made v2's phone build drift from its desktop within a week.
//
// `simple` (2026-09-03) strips it to what a phone can read: SPX only, OI+VOL /
// VOL only, one net bar, no DEX line, no stat row. See GexChartCardProps — the
// stored desktop settings are not rewritten by any of that.
//
// `fill` — the chart owns its drag gesture, so nothing on this screen scrolls.

const GexChartCard = lazy(() => import('@/board/gexChart/GexChartCard').then((m) => ({ default: m.GexChartCard })))

export default function MGex() {
  return (
    <MobileShell title="Gamma Exposure" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <GexChartCard simple />
      </Suspense>
    </MobileShell>
  )
}
