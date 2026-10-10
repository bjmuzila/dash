// ─────────────────────────────────────────────────────────────────────────────
// THE WATCHLIST BUTTON: the desktop top bar, beside Workspace, where the Journal
// button was (Brandon, 2026-10-09: "watchlist isn't really going to be used. need
// to have the expanded view of the watchlist replace the location of where the
// trading journal link is on the toolbar"). Journal is now a row in Workspace →
// Layout (journalLink.ts).
//
// One click opens the watchlist's Advanced view (watchlist/advanced.ts) over the
// chart area — no detour through the docked panel and its ⋯ menu. The view's own
// "Return to chart" (or Escape) closes it; a second press on this button does too.
//
// The docked panel is left as it was: if it was open, it makes way for the view
// and comes back when the view closes; if it was shut, it stays shut. The panel
// itself is still in Workspace → Panels (Alt+W) for anyone who wants it.
//
// The view is its own chunk, fetched on the first press, as it is from the panel.
// Desktop only, like Workspace: the phone keeps Vela's default bar, where the
// Advanced view is still a ⋯ away in the watchlist sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { onPhoneRoute } from '@/pages/vela/nav'
import { WATCHLIST_PANEL_ID } from '@/pages/vela/watchlist/panel'

export const WATCHLIST_ACTION_ID = 'cb-watchlist-adv'

let current: VelaWorkspace | null = null
let registered = false

function toggleAdvanced(ctx: WidgetContext): void {
  void import('./watchlist/advanced').then(
    (m) => {
      if (m.advancedOpen()) return m.closeAdvanced()
      const dockWasOpen = current?.getState().panels?.open === WATCHLIST_PANEL_ID
      if (dockWasOpen) ctx.togglePanel(WATCHLIST_PANEL_ID, false)
      m.openAdvanced(ctx, { restoreDock: dockWasOpen })
    },
    () => ctx.toast('Couldn’t load the watchlist: try again', 'error'),
  )
}

/** The top-bar action. Once; before any workspace is built. Its icon is the panel's (registerWatchlist). */
export function registerWatchlistButton(): void {
  if (registered) return
  registered = true
  registerWidgetAction({
    id: WATCHLIST_ACTION_ID,
    target: 'topbar',
    label: 'Watchlist',
    icon: 'cb-watchlist',
    mobile: 'menu',
    when: () => !onPhoneRoute(),
    run: (ctx) => toggleAdvanced(ctx),
  })
}

/** The desktop page's workspace: the button reads whether the docked panel is open. */
export function bindWatchlistButton(ws: VelaWorkspace): () => void {
  current = ws
  return () => {
    if (current === ws) current = null
  }
}
