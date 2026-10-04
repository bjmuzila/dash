// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT ALERTS — what CB Script's alertcondition() / alert() fire, as rows of
// the toolbar's Alerts feed.
//
// The server feed (GET /proxy/signals) is the engine's; these rows are made in
// THIS browser, by a script running on a Vela chart (pages/vela/script/alerts.ts
// decides when one fires). They live here, in memory and in sessionStorage for
// the tab's life, and AlertsFeed.tsx merges them into its list newest-first.
//
// Their ids are NEGATIVE on purpose: the feed's seen / unread / bloom marks are
// the server's primary keys, compared with `>`, and a local row must never move
// those marks. The pill counts local rows' unread through `ts` instead.
// ─────────────────────────────────────────────────────────────────────────────

import type { AlertItem } from '@/shell/alertTypes'

const KEY = 'cb-v3-script-alerts'
const SEEN_KEY = 'alerts:seen-script'
const MAX = 50
const EVENT = 'cb:script-alert'

let items: AlertItem[] | null = null
let seq = 0

function load(): AlertItem[] {
  if (items) return items
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    items = Array.isArray(raw) ? (raw as AlertItem[]).filter((a) => a && typeof a.id === 'number' && a.id < 0) : []
  } catch {
    items = []
  }
  seq = items.reduce((m, a) => Math.min(m, a.id), 0)
  return items
}

/** Every script alert this tab has fired, newest first. */
export function readScriptAlerts(): AlertItem[] {
  return load()
}

/** Add one (from pages/vela/script/alerts.ts). */
export function pushScriptAlert(a: { ticker: string; title: string; text: string; meta?: string; ts: number }): AlertItem {
  const list = load()
  const d = new Date(a.ts)
  const at = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })
  const item: AlertItem = {
    id: --seq,
    kind: 'script',
    ticker: a.ticker,
    title: a.title,
    text: a.text,
    short: `${a.ticker} ${a.title}`.trim(),
    ...(a.meta ? { meta: a.meta } : {}),
    at,
    ts: a.ts,
  }
  list.unshift(item)
  if (list.length > MAX) list.length = MAX
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* private mode — the row still shows until the tab closes */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: item }))
  return item
}

/** Hear new script alerts. */
export function onScriptAlert(fn: (item: AlertItem) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<AlertItem>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

/** The newest script alert this browser has looked at (epoch ms). */
export function readScriptSeen(): number {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

export function writeScriptSeen(ts: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(ts))
  } catch {
    /* private mode */
  }
}
