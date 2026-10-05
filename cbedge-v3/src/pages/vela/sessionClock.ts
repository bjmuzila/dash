// ─────────────────────────────────────────────────────────────────────────────
// THE SESSION CLOCK: the right side of the desktop top bar (Brandon, 2026-10-04,
// the bottom-of-chart cleanup, C3; mockup generated/2026-10-04-vela-bottom-r2.html).
//
//   [ ● RTH  closes in 2:14:47 │ 13:45:13 ET ]  🔔  Workspace ▾  📷
//
// Vela's bottom strip (nine range chips, a clock, RTH / ETH, ⚙) is gone on the
// desktop, and every chart got its height. What it carried that is still wanted
// moved up: this chip (where the active chart's session stands, and the clock in
// the charts' time zone), RTH / ETH in the timeframe menu ("5m · RTH ▾"), and
// Chart settings in the Workspace menu. The ranges are gone for good.
//
// This file is only the registration, which Vela needs before the workspace is
// built; the chip, its time-zone menu and the timeframe menu's session row are
// sessionClockView.ts, a chunk of its own the page loads once the chart is up.
// The phone keeps Vela's own bottom bar; this action's `when` hides it there.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { onPhoneRoute } from '@/pages/vela/nav'

export const CLOCK_ACTION_ID = 'cb-clock'

let registered = false

export function registerSessionClock(): void {
  if (registered) return
  registered = true
  registerIcon('cb-clock', svg16('<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.3 1.6"/>'))
  registerWidgetAction({
    id: CLOCK_ACTION_ID,
    target: 'topbar',
    // The click is the time-zone menu, so that is the button's name (and the ⋮ row's
    // at a phone width, where the bar itself is hidden).
    label: 'Time zone',
    icon: 'cb-clock',
    mobile: 'menu',
    when: () => !onPhoneRoute(),
    run: () => void import('./sessionClockView').then((m) => m.toggleZoneMenu()),
  })
}
