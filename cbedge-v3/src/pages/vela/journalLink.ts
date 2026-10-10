// ─────────────────────────────────────────────────────────────────────────────
// THE JOURNAL LINK: a row in the Workspace menu, Layout tab (Brandon, 2026-10-09).
//
// It was a top-bar button beside Workspace from 2026-10-08; it moved into the
// menu so its place on the bar could go to the Watchlist button (watchlistButton.ts,
// the expanded watchlist in one click).
//
// Opens journal.cbedge.net — Voltick Journal, LuxAlgo's open-source Trade Journal
// self-hosted (deploy/journal/) — in its own tab. It is a separate app on its own
// host, not a panel: the chart keeps running untouched while it is open.
//
// OWNER ONLY, AND THE ROW KNOWS IT (2026-10-09). The journal is single-user, so
// its gate (/api/tradejournal/verify) lets the owner in and nobody else. The first
// version showed the button to every Vela user; a member clicked it, was told to
// sign in, signed in, was refused again and looped — reported as "cbedge users
// cannot log in". Now the page asks the SAME endpoint the gate asks, once per page
// load, and the row appears only on a 200. Until the answer arrives (or if it
// fails) the row is hidden: a missing row costs nothing, a dead one confuses.
//
// The check goes through this host's own /api proxy (vela.cbedge.net and
// cbedge.net both forward /api to the dashboard), so it reads the same session
// cookie the gate will read. The gate itself is still the only real control.
//
// Desktop only, like the Workspace menu: the phone keeps Vela's default bar.
// ─────────────────────────────────────────────────────────────────────────────

import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

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

/** May this viewer open the journal? False until the gate's own check says 200. */
export function journalAllowed(): boolean {
  return isOwner === true
}

export function openJournal(): void {
  window.open(JOURNAL_URL, 'cb-trade-journal', 'noopener')
}

/** The row's icon. Once; before the Workspace menu first draws. */
export function registerJournalLink(): void {
  if (registered) return
  registered = true
  // an open book
  registerIcon('cb-journal', svg16('<path d="M8 4.5C6.5 3.4 4.5 3 2 3v9.5c2.5 0 4.5.4 6 1.5 1.5-1.1 3.5-1.5 6-1.5V3c-2.5 0-4.5.4-6 1.5zM8 4.5V14"/>'))
}

/**
 * Ask once, at page load, whether this viewer may open the journal, so the
 * answer is in by the time the Workspace menu opens (it reads journalAllowed()
 * on every draw). Takes the workspace only so Vela.tsx binds it like every
 * other piece.
 */
export function bindJournalLink(_ws: VelaWorkspace): () => void {
  void askOnce()
  return () => {}
}
