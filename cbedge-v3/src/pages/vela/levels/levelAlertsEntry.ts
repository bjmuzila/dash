// The Level Alerts panel's registration: the page chunk carries only this. The
// panel, the level reads and the watcher (levelAlerts.ts) load the first time
// the panel opens, or at page load when an alert is already armed (the watcher
// has to be running for it to fire). Right-click the chart → "Level alerts…"
// opens the panel too.

import { registerSidePanel, registerWidgetAction } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

export const ARMED_KEY = 'cb-vela-level-alerts'
export const LEVELS_PANEL_ID = 'cbedge-level-alerts'

let ws: VelaWorkspace | null = null
let registered = false

function hasArmed(): boolean {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(ARMED_KEY) ?? '[]')
    return Array.isArray(j) && j.length > 0
  } catch {
    return false
  }
}

export function registerLevelAlerts(): void {
  if (registered) return
  registered = true
  // a bell over a level line
  registerIcon('cb-level-bell', svg16('<path d="M8 2a3.5 3.5 0 0 0-3.5 3.5V8L3.5 9.5h9L11.5 8V5.5A3.5 3.5 0 0 0 8 2Z"/><path d="M6.8 11.2a1.3 1.3 0 0 0 2.4 0"/><path d="M1.5 14h13"/>'))
  registerSidePanel({
    id: LEVELS_PANEL_ID,
    title: 'Level Alerts',
    icon: 'cb-level-bell',
    order: 103,
    width: 340,
    resizable: true,
    minWidth: 280,
    maxWidth: 560,
    mount: (ctx, body, header) => {
      header.setTitle('Level Alerts')
      body.textContent = 'Loading…'
      let h: { onChart: () => void; destroy: () => void } | null = null
      let dead = false
      void import('./levelAlerts').then((m) => {
        if (dead) return
        if (ws) m.startWatch(ws)
        h = m.mountLevelPanel(() => ctx.chart, body)
      })
      return {
        onChart: () => h?.onChart(),
        destroy: () => {
          dead = true
          h?.destroy()
        },
      }
    },
  })
  registerWidgetAction({
    id: 'cb-level-alerts',
    target: 'context:body',
    label: 'Level alerts…',
    icon: 'cb-level-bell',
    run: (ctx) => ctx.togglePanel(LEVELS_PANEL_ID, true),
  })
}

/** Start the watcher for this workspace when anything is armed. */
export function bindLevelAlerts(w: VelaWorkspace): () => void {
  ws = w
  let off: (() => void) | null = null
  let dead = false
  if (hasArmed()) {
    void import('./levelAlerts').then((m) => {
      if (!dead) off = m.startWatch(w)
    })
  }
  return () => {
    dead = true
    off?.()
    if (ws === w) ws = null
  }
}
