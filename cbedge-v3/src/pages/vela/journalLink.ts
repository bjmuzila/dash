// ─────────────────────────────────────────────────────────────────────────────
// THE JOURNAL LINK: one top-bar button, beside Workspace (Brandon, 2026-10-08).
//
// Opens journal.cbedge.net — Voltick Journal, LuxAlgo's open-source Trade Journal
// self-hosted (deploy/journal/) — in its own tab. It is a separate app on its own
// host, not a panel: the chart keeps running untouched while it is open.
//
// OWNER ONLY, AND THE BUTTON KNOWS IT (2026-10-09). The journal is single-user, so
// its gate (/api/tradejournal/verify) lets the owner in and nobody else. The first
// version showed the button to every Vela user; a member clicked it, was told to
// sign in, signed in, was refused again and looped — reported as "cbedge users
// cannot log in". Now the page asks the SAME endpoint the gate asks, once per page
// load, and the button appears only on a 200. Until the answer arrives (or if it
// fails) the button is hidden: a missing button costs nothing, a dead one confuses.
//
// The check goes through this host's own /api proxy (vela.cbedge.net and
// cbedge.net both forward /api to the dashboard), so it reads the same session
// cookie the gate will read. The gate itself is still the only real control.
//
// Desktop only, like Workspace: the phone keeps Vela's default bar.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { onPhoneRoute } from '@/pages/vela/nav'

export const JOURNAL_ACTION_ID = 'cb-journal'
export const JOURNAL_URL = 'https://journal.cbedge.net/'

let registered = false
/** null = not asked yet / in flight; true only on a 200 from the gate's own check. */
let isOwner: boolean | null = null
let asking: Promise<boolean> | null = null

function askOnce(): Promise<boolean> {
  if (isOwner !== null) return Promise.resolve(isOwner)
  if (!asking) {
    asking = fetch('/api/tradejournal/verify', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.status === 200)
      .catch(() => false)
      .then((ok) => {
        isOwner = ok
        return ok
      })
  }
  return asking
}

export function registerJournalLink(): void {
  if (registered) return
  registered = true
  // an open book
  registerIcon('cb-journal', svg16('<path d="M8 4.5C6.5 3.4 4.5 3 2 3v9.5c2.5 0 4.5.4 6 1.5 1.5-1.1 3.5-1.5 6-1.5V3c-2.5 0-4.5.4-6 1.5zM8 4.5V14"/>'))
  registerWidgetAction({
    id: JOURNAL_ACTION_ID,
    target: 'topbar',
    label: 'Journal',
    icon: 'cb-journal',
    mobile: 'menu',
    when: () => isOwner === true && !onPhoneRoute(),
    run: () => {
      window.open(JOURNAL_URL, 'cb-trade-journal', 'noopener')
    },
  })
}

/** Ask once whether this viewer may open the journal; on a yes, redraw the bar so the button appears. */
export function bindJournalLink(ws: VelaWorkspace): () => void {
  let live = true
  void askOnce().then((ok) => {
    if (ok && live) ws.refreshActions()
  })
  return () => {
    live = false
  }
}
