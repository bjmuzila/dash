// ─────────────────────────────────────────────────────────────────────────────
// ONE LOOK FOR EVERY CHART, AND A SAVE BUTTON IN CHART SETTINGS (Brandon,
// 2026-10-09: "theme should be for all the charts if changed on one. chart
// settings needs a save button where the defaults is. save layout / reset
// defaults").
//
// ONE LOOK. Vela keeps a renderer config per chart (candle colours, grid,
// background, scales, crosshair…), so recolouring the SPX chart left SPY and QQQ
// on Vela's green / red. Vela already has the cure: its STYLE sync link (Layout ▾
// → Sync → Style) mirrors that slice of the config from the chart you edit onto
// every other chart, and lines up any chart a layout change adds. It ships off.
// bindChartStyleSync turns it ON once per saved document (`<persist key>-style`
// marks it done) and aligns every chart to the active one; unticking Style in the
// Layout menu afterwards is respected.
//
// THE FOOTER. Vela's Chart settings dialog has one footer button, Reset
// defaults. It becomes:
//
//   [ Save layout ]  [ Reset defaults ]  [ Factory ]
//
//   Save layout      this chart's look becomes YOUR default: put on every chart
//                    now, kept in this browser (`cb-vela-chart-layout`), and the
//                    workspace is written at once (no waiting on Vela's debounce)
//   Reset defaults   back to your saved layout, on every chart. Nothing saved:
//                    Vela's own reset (its first-run look), as before
//   Factory          only once a layout is saved: Vela's own reset, and your saved
//                    layout is forgotten
//
// Only the STYLE slice is saved and applied (STYLE_KEYS: the same blocks Vela's
// style link mirrors), never the price style (candles / line / …) or anything
// per-symbol. The canvas Theme (dark / light) is already workspace-wide in Vela.
//
// Vela offers no seam in that dialog, so the buttons are added when it appears
// (a watch on the page for `.vela-dialog--settings`, the class Vela gives it),
// the way indicatorPresets.ts dresses the indicator dialogs.
// ─────────────────────────────────────────────────────────────────────────────

import type { VelaWorkspace } from '@luxalgo/vela/workspace'

const STORE_KEY = 'cb-vela-chart-layout'

/** The config blocks Vela's style link mirrors (workspace.cjs STYLE_SYNC_CONFIG_KEYS), plus the bar spacing. */
const STYLE_KEYS = ['layout', 'panes', 'grid', 'margins', 'priceScale', 'crosshair', 'animations', 'candles', 'bars', 'line', 'area', 'baseline', 'sessions'] as const

type Cfg = Record<string, unknown>

const isRec = (v: unknown): v is Cfg => !!v && typeof v === 'object' && !Array.isArray(v)

/** The style slice of a renderer config. */
function styleOf(config: unknown): Cfg | null {
  if (!isRec(config)) return null
  const out: Cfg = {}
  for (const k of STYLE_KEYS) if (isRec(config[k])) out[k] = config[k]
  const spacing = isRec(config.series) ? config.series.spacing : undefined
  if (typeof spacing === 'number') out.series = { spacing }
  return Object.keys(out).length ? out : null
}

function readSaved(): Cfg | null {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    return isRec(j) ? j : null
  } catch {
    return null
  }
}

function writeSaved(v: Cfg | null): void {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v))
    else localStorage.removeItem(STORE_KEY)
  } catch {
    /* private mode: it still applies for this visit */
  }
}

/** Put a style slice on every chart. The style link would echo it anyway; this also covers it being off. */
function applyAll(ws: VelaWorkspace, style: Cfg): void {
  for (const cell of ws.cells()) {
    try {
      cell.chart.renderer.applyConfig(style)
    } catch {
      /* one chart refusing never stops the others */
    }
  }
}

/** Write the workspace now (Vela's own save is debounced ~500 ms). */
function persistNow(ws: VelaWorkspace, persistKey: string): void {
  try {
    localStorage.setItem(persistKey, JSON.stringify(ws.getState()))
  } catch {
    /* Vela's debounced write still follows */
  }
}

// ── One look for every chart ─────────────────────────────────────────────────

/** Turn Vela's Style sync on, once per saved document, aligned to the active chart. */
export function bindChartStyleSync(ws: VelaWorkspace, persistKey: string): void {
  const done = `${persistKey}-style`
  try {
    if (localStorage.getItem(done)) return
    localStorage.setItem(done, '1')
  } catch {
    return // no storage: Vela's own default stands
  }
  if (!ws.sync.get('style')) ws.sync.set('style', true)
  // a layout saved before this keeps each chart's own look; give them all the active one
  const saved = readSaved()
  if (saved) applyAll(ws, saved)
}

// ── The dialog footer ────────────────────────────────────────────────────────

/** The chart whose settings dialog this is (Vela mounts it inside the cell). */
function ownerChart(ws: VelaWorkspace, dialog: HTMLElement) {
  return (ws.cells().find((c) => c.host.contains(dialog)) ?? ws.active).chart
}

/** Reopen the dialog on the tab it was on, so every control shows the values just applied. */
function reopen(ws: VelaWorkspace, dialog: HTMLElement): void {
  const chart = ownerChart(ws, dialog)
  const section = dialog.querySelector<HTMLElement>('.vela-sd-tab.on')?.textContent?.trim() || undefined
  chart.renderer.closeDialogs()
  requestAnimationFrame(() => chart.renderer.openSettings(section))
}

function flash(btn: HTMLButtonElement, text: string, back: string): void {
  btn.textContent = text
  btn.dataset.flash = '1'
  setTimeout(() => {
    if (!btn.isConnected) return
    btn.textContent = back
    delete btn.dataset.flash
  }, 1600)
}

/** Vela's button class sets `display`, so `hidden` alone would not hide it. */
const show = (b: HTMLElement, on: boolean) => {
  b.style.display = on ? '' : 'none'
}

function button(doc: Document, text: string, title: string): HTMLButtonElement {
  const b = doc.createElement('button')
  b.type = 'button'
  b.className = 'vela-sd-btn cb-cs-btn'
  b.textContent = text
  b.title = title
  return b
}

function dress(ws: VelaWorkspace, persistKey: string, dialog: HTMLElement): void {
  if (dialog.dataset.cbCs) return
  const foot = dialog.querySelector<HTMLElement>('.vela-dialog-footer')
  const reset = foot ? [...foot.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Reset defaults') : undefined
  if (!foot || !reset) return
  dialog.dataset.cbCs = '1'
  const doc = dialog.ownerDocument
  const saved = readSaved()

  const factory = button(doc, 'Factory', "Vela's original look on every chart, and forget your saved layout")
  factory.classList.add('cb-cs-factory')
  show(factory, !!saved)
  factory.addEventListener('click', () => {
    writeSaved(null)
    show(factory, false)
    reset.title = 'Back to the default look, on every chart'
    reset.click() // nothing saved now: Vela's own reset
  })

  const save = button(doc, 'Save layout', 'Make this look your default: every chart takes it now, and Reset defaults comes back to it')
  save.classList.add('cb-cs-save')
  save.addEventListener('click', () => {
    const style = styleOf(ownerChart(ws, dialog).renderer.getConfig())
    if (!style) return
    writeSaved(style)
    applyAll(ws, style)
    persistNow(ws, persistKey)
    flash(save, 'Saved', 'Save layout')
    show(factory, true)
    reset.title = 'Back to your saved layout, on every chart'
  })

  // Vela's Reset defaults: back to the saved layout when there is one (Vela's own
  // handler is stopped then), its first-run look otherwise
  reset.title = saved ? 'Back to your saved layout, on every chart' : 'Back to the default look, on every chart'
  reset.addEventListener(
    'click',
    (e) => {
      const mine = readSaved()
      if (!mine) return // Vela's reset runs; the style link carries it to every chart
      e.preventDefault()
      e.stopImmediatePropagation()
      applyAll(ws, mine)
      persistNow(ws, persistKey)
      reopen(ws, dialog)
    },
    true,
  )
  // …and with nothing saved, Vela's reset (it has just run, on this chart) goes on
  // every chart even with the Style link unticked
  reset.addEventListener('click', () => {
    if (readSaved()) return
    const style = styleOf(ownerChart(ws, dialog).renderer.getConfig())
    if (style) applyAll(ws, style)
  })

  foot.prepend(save)
  reset.after(factory)
}

/** Watch the page for Vela's Chart settings dialog and add Save layout / Factory to its footer. */
export function bindChartSettingsSave(ws: VelaWorkspace, persistKey: string): () => void {
  const doc = ws.root.ownerDocument
  const scan = (n: Node) => {
    if (!(n instanceof HTMLElement)) return
    const d = n.classList.contains('vela-dialog--settings') ? n : n.querySelector<HTMLElement>('.vela-dialog--settings')
    if (d) dress(ws, persistKey, d)
  }
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) scan(n)
  })
  mo.observe(doc.body, { childList: true, subtree: true })
  for (const d of doc.querySelectorAll<HTMLElement>('.vela-dialog--settings')) dress(ws, persistKey, d)
  return () => mo.disconnect()
}
