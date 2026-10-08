// ─────────────────────────────────────────────────────────────────────────────
// THE JOURNAL LINK: one top-bar button, beside Workspace (Brandon, 2026-10-08).
//
// Opens journal.cbedge.net — LuxAlgo's open-source Trade Journal, self-hosted
// (deploy/journal/) — in its own tab. It is a separate app on its own host,
// not a panel: the journal is a Next.js + SQLite server with its own pages,
// and the chart keeps running untouched while it is open.
//
// Who gets in is decided there, by nginx (/api/tradejournal/verify, owner
// only — the journal is single-user). The button itself does not check.
//
// Desktop only, like Workspace: the phone keeps Vela's default bar.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { onPhoneRoute } from '@/pages/vela/nav'

export const JOURNAL_ACTION_ID = 'cb-journal'
export const JOURNAL_URL = 'https://journal.cbedge.net/'

let registered = false

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
    when: () => !onPhoneRoute(),
    run: () => {
      window.open(JOURNAL_URL, 'cb-trade-journal', 'noopener')
    },
  })
}
