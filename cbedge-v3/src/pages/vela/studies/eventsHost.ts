// ─────────────────────────────────────────────────────────────────────────────
// The Events study's link to the page (events.ts and eventsLayer.ts have the
// study). Two small things the study cannot do from inside its own instance:
//
//   · change its own inputs: a mark's card has "Hide high impact" (and so on),
//     which goes through the instance's handle on its chart, so the settings
//     dialog, the legend card's menu and the saved layout all see it
//   · tell the legend card how many marks it is drawing ("13 this week"),
//     without the card loading the study's chunk
//
// This file is in the page chunk, so it stays this small.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndicatorHandle, InputValue } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

let ws: VelaWorkspace | null = null

/** The page's workspace, for finding an instance by its id. */
export function bindEventsHost(w: VelaWorkspace): () => void {
  ws = w
  return () => {
    if (ws === w) ws = null
  }
}

/** The Events instance `id`, on whichever chart carries it. */
export function eventsHandle(id: string): IndicatorHandle | null {
  for (const c of ws?.cells() ?? []) {
    const h = c.chart.indicators().find((x) => x.id === id)
    if (h) return h
  }
  return null
}

/** Set one input of the Events instance `id` (a card's "Hide …"). */
export function setEventsInput(id: string, key: string, value: InputValue): void {
  eventsHandle(id)?.setInputs({ [key]: value })
}

// ── how many marks each instance draws this week ──

const counts = new Map<string, number>()
const listeners = new Set<() => void>()

export function publishEventsCount(id: string, n: number | null): void {
  if (n == null) counts.delete(id)
  else if (counts.get(id) === n) return
  else counts.set(id, n)
  for (const fn of [...listeners]) fn()
}

export function eventsCount(id: string): number | null {
  return counts.get(id) ?? null
}

export function onEventsCount(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
