// The Setups button: named chart setups, one click to load. The page chunk
// carries only the button; the menu (setupsMenu.ts) loads on the first click.
// The Stats button beside it shows / hides the session stats strip above the
// chart (SessionStrip.tsx).

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { onPhoneRoute } from '@/pages/vela/nav'

let ws: VelaWorkspace | null = null
let registered = false

export function bindSetups(w: VelaWorkspace): () => void {
  ws = w
  return () => {
    if (ws === w) ws = null
  }
}

export const setupsWorkspace = (): VelaWorkspace | null => ws

// ── the stats strip's on/off, shared with the React strip ──
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
  // a strip of numbers
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
  registerWidgetAction({
    id: 'cb-stats',
    target: 'topbar',
    label: 'Session stats',
    icon: 'cb-stats',
    iconOnly: true,
    order: 6,
    mobile: 'menu',
    run: () => {
      const phone = onPhoneRoute()
      setStripShown(!stripShown(phone))
    },
  })
}
