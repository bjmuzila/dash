// ─────────────────────────────────────────────────────────────────────────────
// CB WALLS OPACITY — one slider that fades the walls lines on every Vela chart.
//
// The walls are drawn at full strength in the migration chart's colours, and on
// a stack of small phone charts the gold CORE step and its wall can drown the
// candles. This is the fader: a single opacity, 10–100%, shared by every CB
// Walls study on every chart (desktop and phone alike), remembered per browser
// under `cb-v3-vela-walls-opacity`. Default 60%.
//
// ── Where the slider lives ───────────────────────────────────────────────────
// Two doors to the same strip:
//   · desktop — a LEGEND ACTION on the CB Walls row: the drop icon that appears
//     beside the row's eye / gear / ✕ when the row is hovered.
//   · phone — ⋮ → "Walls opacity". Vela's phone legend folds into a chip that
//     opens the object tree, so a legend-row button is never reachable there;
//     the row is gated to the mobile layout so desktop gets no extra topbar
//     button for it.
// Either one docks a slim strip above Vela's bottom bar (WidgetContext.dockStrip
// — the charts give up that much height while it is open) with a real range
// slider. Dragging repaints live — a fade is a re-emit of the lines already
// computed, no fetch — and the value is saved on release. The same door again,
// or the strip's ✕, closes it.
//
// Vela's own settings dialog has no slider control (numeric inputs render as a
// number box), which is why this is a strip and not a study input.
// ─────────────────────────────────────────────────────────────────────────────

import { registerLegendAction, registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'

const STORE_KEY = 'cb-v3-vela-walls-opacity'
/** Percent. Below 10% a line is gone; the ✕ / eye on the legend is how you hide it. */
export const OPACITY_MIN = 10
export const OPACITY_MAX = 100
export const OPACITY_DEFAULT = 60
const OPACITY_STEP = 5

function clampPct(v: number): number {
  return Math.max(OPACITY_MIN, Math.min(OPACITY_MAX, Math.round(v)))
}

function readPct(): number {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) ? clampPct(n) : OPACITY_DEFAULT
  } catch {
    return OPACITY_DEFAULT
  }
}

let pct = readPct()
const listeners = new Set<() => void>()

/** The walls' line opacity, 0.1–1. */
export function wallsOpacity(): number {
  return pct / 100
}

/** Set the opacity (percent) and repaint every open walls study; `save` writes it through. */
export function setWallsOpacity(next: number, save: boolean): void {
  const v = clampPct(next)
  if (save) {
    try {
      localStorage.setItem(STORE_KEY, String(v))
    } catch {
      /* private mode: it still applies for this visit */
    }
  }
  if (v === pct) return
  pct = v
  for (const fn of listeners) fn()
}

/** Repaint hook for a walls study. Returns the unsubscribe. */
export function onWallsOpacity(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// ── The strip ────────────────────────────────────────────────────────────────

/** The open strip per workspace root, so the icon toggles rather than stacks. */
const open = new WeakMap<HTMLElement, () => void>()

function toggleStrip(ctx: WidgetContext): void {
  const close = open.get(ctx.host)
  if (close) {
    close()
    return
  }
  const doc = ctx.host.ownerDocument
  const el = doc.createElement('div')
  el.className = 'cb-vela-opacity'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', 'CB Walls opacity')

  const label = doc.createElement('span')
  label.className = 'cb-vela-opacity-label'
  label.textContent = 'Walls opacity'

  const range = doc.createElement('input')
  range.type = 'range'
  range.min = String(OPACITY_MIN)
  range.max = String(OPACITY_MAX)
  range.step = String(OPACITY_STEP)
  range.value = String(pct)
  range.setAttribute('aria-label', 'CB Walls line opacity, percent')

  const val = doc.createElement('span')
  val.className = 'cb-vela-opacity-val'
  val.textContent = `${pct}%`

  const done = doc.createElement('button')
  done.type = 'button'
  done.className = 'cb-vela-opacity-close'
  done.setAttribute('aria-label', 'Close opacity slider')
  done.textContent = '✕'

  // Live while dragging, one repaint per frame; saved when the thumb is let go.
  let frame = 0
  range.addEventListener('input', () => {
    val.textContent = `${range.value}%`
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      setWallsOpacity(Number(range.value), false)
    })
  })
  range.addEventListener('change', () => setWallsOpacity(Number(range.value), true))

  el.append(label, range, val, done)
  const undock = ctx.dockStrip(el)
  const closeStrip = () => {
    if (frame) cancelAnimationFrame(frame)
    setWallsOpacity(Number(range.value), true)
    undock()
    open.delete(ctx.host)
  }
  done.addEventListener('click', closeStrip)
  open.set(ctx.host, closeStrip)
}

let registered = false

/** Register the legend action (and its icon). Once; before a workspace is built. */
export function registerWallsOpacity(): void {
  if (registered) return
  registered = true
  // A drop, half filled — "how much ink". currentColor, so it takes the legend's tone.
  registerIcon(
    'cb-opacity',
    svg16('<path d="M8 1.8C8 1.8 3.3 7 3.3 10a4.7 4.7 0 0 0 9.4 0C12.7 7 8 1.8 8 1.8z"/><path d="M8 14.7a4.7 4.7 0 0 1-4.7-4.7h9.4A4.7 4.7 0 0 1 8 14.7z" fill="currentColor" stroke="none"/>'),
  )
  registerLegendAction({
    id: 'cbedge-walls-opacity',
    icon: 'cb-opacity',
    tooltip: 'Line opacity',
    // A native study (no script source) titled as ours.
    when: (ind) => ind.source === undefined && /CB (Edge )?Walls/i.test(ind.title),
    run: (ctx) => toggleStrip(ctx),
  })
  registerWidgetAction({
    id: 'cbedge-walls-opacity',
    target: 'topbar',
    label: 'Walls opacity',
    icon: 'cb-opacity',
    // Should a desktop topbar ever draw it (a narrow window that went mobile and
    // came back), it is the compact icon, not a text button.
    iconOnly: true,
    mobile: 'menu',
    // The workspace root carries Vela's size class; on the desktop layout the
    // legend action above is the door, and the topbar stays as it was.
    when: (ctx) => ctx.host.getAttribute('data-layout') === 'mobile',
    run: (ctx) => toggleStrip(ctx),
  })
}
