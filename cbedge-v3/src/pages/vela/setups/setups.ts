// The Setups action: named chart setups, one click to load. The page chunk
// carries only the action; the menu (setupsMenu.ts) loads on the first click.
// The Volt watch action beside it shows / hides the tape at the top of the page
// (tape/TapeScroll.tsx — the watchlist's Volts, stepping past; it replaced the
// session stats strip, SessionStrip.tsx, on 2026-10-07; "Tape scroll" until
// 2026-10-08), and this file keeps its two settings: on / off and its order
// (A–Z or nearest Volt first), both switched from the Workspace menu.
//
// On the desktop both live in the Workspace menu now (workspaceMenu.ts: Layout →
// Setups, Panels → Volt watch / Volt watch order); the desktop bar no longer lists the right-hand
// actions. The registrations stay for the phone's ⋮ rows — Setups only: the tape
// is desktop only, so phoneChrome.ts drops its row.

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

let ws: VelaWorkspace | null = null
let registered = false

export function bindSetups(w: VelaWorkspace): () => void {
  ws = w
  return () => {
    if (ws === w) ws = null
  }
}

export const setupsWorkspace = (): VelaWorkspace | null => ws

// ── the tape's on/off, shared with the React tape (the key is the old stats
// strip's, so whoever had the strip off keeps the tape off) ──
const STRIP_KEY = 'cb-vela-strip'
const stripSubs = new Set<() => void>()
export function stripShown(phone: boolean): boolean {
  try {
    const v = localStorage.getItem(STRIP_KEY)
    return v == null ? !phone : v === '1'
  } catch {
    return !phone
  }
}
export function setStripShown(on: boolean): void {
  try {
    localStorage.setItem(STRIP_KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
  for (const fn of stripSubs) fn()
}
export function onStrip(fn: () => void): () => void {
  stripSubs.add(fn)
  return () => {
    stripSubs.delete(fn)
  }
}

// ── the tape's sort: A–Z, or nearest Volt first (the default) ──
export type TapeSort = 'az' | 'near'
const SORT_KEY = 'cb-vela-tape-sort'
export function tapeSort(): TapeSort {
  try {
    return localStorage.getItem(SORT_KEY) === 'az' ? 'az' : 'near'
  } catch {
    return 'near'
  }
}
export function setTapeSort(s: TapeSort): void {
  try {
    localStorage.setItem(SORT_KEY, s)
  } catch {
    /* private mode */
  }
  for (const fn of stripSubs) fn()
}

function anchorFor(ctx: WidgetContext, label: string): HTMLElement | null {
  const act = document.activeElement
  if (act instanceof HTMLElement && act.getAttribute('aria-label') === label) return act
  return ctx.host.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
}

export function registerSetups(): void {
  if (registered) return
  registered = true
  // three stacked panes
  registerIcon('cb-setups', svg16('<rect x="2" y="2" width="12" height="3.5" rx="1"/><rect x="2" y="6.75" width="12" height="3.5" rx="1"/><rect x="2" y="11.5" width="12" height="2.5" rx="1"/>'))
  // a strip of numbers (Volt watch)
  registerIcon('cb-stats', svg16('<rect x="1.5" y="4.5" width="13" height="7" rx="1.5"/><path d="M4.5 9.5V7M7 9.5V6.5M9.5 9.5V8M12 9.5V6"/>'))
  registerWidgetAction({
    id: 'cb-setups',
    target: 'topbar',
    label: 'Setups',
    icon: 'cb-setups',
    iconOnly: true,
    order: 5,
    mobile: 'menu',
    run: (ctx) => {
      const anchor = anchorFor(ctx, 'Setups')
      void import('./setupsMenu').then((m) => m.openSetups(ctx, anchor))
    },
  })
  // The 'Volt watch' top-bar action is retired (2026-10-09) with the strip.
}
