import { Suspense, lazy } from 'react'
import { MobileShell } from '../MobileShell'

// /m/econ — the economic calendar and earnings.
//
// It IS the home board's `econ-calendar` card. `fill` because the card scrolls
// INSIDE itself — it is built to sit in a board slot of a fixed height and keep
// its own filter row pinned — so an outer scroll would give the screen two
// scrollbars and detach that row from the rows it filters.
//
// No ticker control: the calendar is not a per-symbol surface, and a picker
// that changed nothing on screen would be a control that lies.

const EconCalendarCard = lazy(() =>
  import('@/board/econCalendar/EconCalendarCard').then((m) => ({ default: m.EconCalendarCard })),
)

export default function MEcon() {
  return (
    <MobileShell title="Calendar & Earnings" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <EconCalendarCard />
      </Suspense>
    </MobileShell>
  )
}
