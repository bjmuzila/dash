// ─────────────────────────────────────────────────────────────────────────────
// INDICATOR DEFAULTS AND SAVED SETTINGS (Brandon, 2026-10-05: "all indicators
// should have a reset defaults and a save defaults, also a way to save their
// own with name").
//
// Every indicator's settings dialog is Vela's own (its gear, the legend card's
// ⚙). Its footer gets one more button on the left, in place of Vela's "Reset
// defaults":
//
//   [ Defaults ▾ ]                                   [ Cancel ]  [ Ok ]
//     Reset to my default      (Reset defaults when none is saved)
//     Save as my default
//     Factory defaults         (only once a default is saved)
//     Forget my default        (the same)
//     ── SAVED SETTINGS ──
//     Scalping 1m          ✕   click a name to load it
//     [ Name these settings ]  [ Save ]
//
// Kept per KIND of indicator (a Vela or CB Edge study by its type, a CB Script
// by its library id), in this browser, so they follow it onto every chart.
// "My default" is also what a NEW copy starts with: the Indicators dialog
// (indicatorPicker.ts) arms applyDefaultOnAdd before it adds one. A chart that
// already carries the indicator keeps its own settings.
//
// Loading saved settings writes them through the indicator's own handle
// (setInputs / setProps, so undo, the saved layout and the legend see it), then
// reopens the dialog so every control shows them. Only the keys the indicator
// still has are applied. Factory defaults is Vela's own Reset defaults button,
// kept hidden and clicked.
//
// Vela offers no seam in its dialog, so the button is added to the dialog's
// footer when it appears (a watch on the page for Vela's dialog layer). The
// dialog names its inputs `vela-inp-<indicator id>-<key>`, which is how the
// dialog is matched to its indicator.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndicatorHandle, InputValue, Vela } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { libIdOf } from './script/library'

const STORE_KEY = 'cb-vela-ind-presets'

type Bag = Record<string, InputValue>
interface Values {
  inputs: Bag
  props: Bag
}
interface Entry {
  /** "My default": what Reset loads and what a new copy starts with. */
  def?: Values
  /** Saved settings by name. */
  presets: Record<string, Values & { at: number }>
}
type Store = Record<string, Entry>

// ── The store (this browser) ─────────────────────────────────────────────────

function readStore(): Store {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Store) : {}
  } catch {
    return {}
  }
}
function writeStore(s: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* private mode, or full */
  }
}
function entryOf(s: Store, key: string): Entry {
  const e = s[key]
  if (e && typeof e === 'object') {
    if (!e.presets || typeof e.presets !== 'object') e.presets = {}
    return e
  }
  return (s[key] = { presets: {} })
}

/** Which indicator this is, for its defaults: a study by type, a CB Script by library id. */
export function presetKey(h: IndicatorHandle): string {
  if (h.nativeType) return `native:${h.nativeType}`
  const lib = libIdOf(h.id)
  return lib ? `script:${lib}` : `title:${h.title}`
}

const isValue = (v: unknown): v is InputValue => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'

/** `bag` cut to the keys the indicator has now. */
function pick(bag: Bag | undefined, keys: ReadonlySet<string>): Bag {
  const out: Bag = {}
  for (const [k, v] of Object.entries(bag ?? {})) if (keys.has(k) && isValue(v)) out[k] = v
  return out
}

/** The indicator's settings now. */
function capture(h: IndicatorHandle): Values {
  return {
    inputs: pick(h.inputValues(), new Set(h.inputs.map((i) => i.key))),
    props: pick(h.propValues(), new Set(h.props.map((p) => p.key))),
  }
}

/** Write saved settings through the handle (only the keys it still has). */
function apply(h: IndicatorHandle, v: Values): void {
  const inputs = pick(v.inputs, new Set(h.inputs.map((i) => i.key)))
  const props = pick(v.props, new Set(h.props.map((p) => p.key)))
  if (Object.keys(inputs).length) h.setInputs(inputs)
  if (Object.keys(props).length) h.setProps(props)
}

/** "My default" for this kind of indicator, if one is saved. */
export function savedDefault(h: IndicatorHandle): Values | null {
  return readStore()[presetKey(h)]?.def ?? null
}

/**
 * A NEW copy starts with "my default": call BEFORE adding an indicator. The next
 * indicator that lands on `chart` and passes `match` gets the saved default, once
 * it has started (Vela drops inputs set before then). Gives up after 15 s.
 */
export function applyDefaultOnAdd(chart: Vela, match: (h: IndicatorHandle) => boolean): void {
  const before = new Set(chart.indicators().map((h) => h.id))
  let done = false
  const finish = () => {
    done = true
    off()
    clearTimeout(timer)
  }
  const off = chart.on('indicator:added', ({ id }) => {
    if (done || before.has(id)) return
    const h = chart.indicators().find((x) => x.id === id)
    if (!h || !match(h)) return
    finish()
    const def = savedDefault(h)
    if (def) apply(h, def)
  })
  const timer = setTimeout(finish, 15_000)
}

// ── The dialog ───────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** The indicator an open settings dialog belongs to, and its chart. */
function ownerOf(ws: VelaWorkspace, panel: HTMLElement): { chart: Vela; h: IndicatorHandle } | null {
  let best: { chart: Vela; h: IndicatorHandle } | null = null
  for (const cell of ws.cells()) {
    for (const h of cell.chart.indicators()) {
      if (best && best.h.id.length >= h.id.length) continue
      if (panel.querySelector(`[id^="vela-inp-${CSS.escape(h.id)}-"]`)) best = { chart: cell.chart, h }
    }
  }
  return best
}

let menu: { el: HTMLElement; cleanup: () => void } | null = null
function closeMenu(): void {
  menu?.cleanup()
  menu = null
}

/** Reopen the dialog on its indicator, so every control shows the values just written. */
function reopen(chart: Vela, id: string): void {
  requestAnimationFrame(() => chart.renderer.openIndicatorSettings(id))
}

/** Say what just happened on the button for a moment ("Saved as default"). */
function flash(btn: HTMLButtonElement, text: string): void {
  const label = btn.querySelector<HTMLElement>('.cb-pr-lab')
  if (!label) return
  label.textContent = text
  btn.dataset.flash = '1'
  setTimeout(() => {
    if (!btn.isConnected) return
    label.textContent = 'Defaults'
    delete btn.dataset.flash
  }, 1600)
}

function openMenu(ws: VelaWorkspace, panel: HTMLElement, btn: HTMLButtonElement, factory: HTMLButtonElement | null): void {
  closeMenu()
  const hit = ownerOf(ws, panel)
  const layer = panel.parentElement
  if (!hit || !layer) return
  const { chart, h } = hit
  const doc = panel.ownerDocument
  const key = presetKey(h)
  const box = el(doc, 'div', 'cb-pr-menu')
  box.setAttribute('role', 'menu')
  box.setAttribute('aria-label', 'Defaults and saved settings')

  const draw = () => {
    box.replaceChildren()
    const store = readStore()
    const entry = store[key]
    const def = entry?.def ?? null
    const item = (text: string, title: string, run: () => void, cls = '') => {
      const b = el(doc, 'button', `cb-pr-item ${cls}`.trim(), text)
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.title = title
      b.addEventListener('click', run)
      box.append(b)
      return b
    }
    // defaults
    if (def) {
      item('Reset to my default', 'Load the settings you saved as your default', () => {
        closeMenu()
        apply(h, def)
        reopen(chart, h.id)
      })
    } else {
      item('Reset defaults', "The indicator's own settings", () => {
        closeMenu()
        factory?.click()
      })
    }
    item('Save as my default', 'Keep these settings as your default: Reset loads them, and a new copy of this indicator starts with them', () => {
      const s = readStore()
      entryOf(s, key).def = capture(h)
      writeStore(s)
      closeMenu()
      flash(btn, 'Saved as default')
    })
    if (def) {
      item('Factory defaults', "The indicator's own settings, as it shipped", () => {
        closeMenu()
        factory?.click()
      })
      item('Forget my default', 'Stop using your saved default (your settings now stay as they are)', () => {
        const s = readStore()
        delete entryOf(s, key).def
        writeStore(s)
        draw()
      })
    }
    // saved settings
    box.append(el(doc, 'div', 'cb-pr-sep'), el(doc, 'div', 'cb-pr-head', 'Saved settings'))
    const names = Object.keys(entry?.presets ?? {}).sort((a, b) => a.localeCompare(b))
    if (!names.length) box.append(el(doc, 'div', 'cb-pr-none', 'None yet. Name these settings below to keep them.'))
    for (const name of names) {
      const row = el(doc, 'div', 'cb-pr-row')
      const load = el(doc, 'button', 'cb-pr-item cb-pr-name', name)
      load.type = 'button'
      load.setAttribute('role', 'menuitem')
      load.title = `Load "${name}"`
      load.addEventListener('click', () => {
        const v = readStore()[key]?.presets[name]
        closeMenu()
        if (!v) return
        apply(h, v)
        reopen(chart, h.id)
      })
      const del = el(doc, 'button', 'cb-pr-del', '✕')
      del.type = 'button'
      del.title = `Delete "${name}"`
      del.setAttribute('aria-label', `Delete ${name}`)
      del.addEventListener('click', () => {
        const s = readStore()
        delete entryOf(s, key).presets[name]
        writeStore(s)
        draw()
      })
      row.append(load, del)
      box.append(row)
    }
    // save as a name
    const form = el(doc, 'form', 'cb-pr-form')
    const input = el(doc, 'input', 'cb-pr-input')
    input.type = 'text'
    input.placeholder = 'Name these settings'
    input.maxLength = 40
    input.setAttribute('aria-label', 'Name for these settings')
    const save = el(doc, 'button', 'cb-pr-save', 'Save')
    save.type = 'submit'
    form.append(input, save)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const name = input.value.trim()
      if (!name) {
        input.focus()
        return
      }
      const s = readStore()
      entryOf(s, key).presets[name] = { ...capture(h), at: Date.now() }
      writeStore(s)
      draw()
      flash(btn, `Saved "${name}"`)
    })
    box.append(form)
  }
  draw()

  // above the button, inside the dialog's layer (the panel clips what overflows it)
  layer.append(box)
  const lr = layer.getBoundingClientRect()
  const br = btn.getBoundingClientRect()
  box.style.left = `${Math.max(8, br.left - lr.left)}px`
  box.style.bottom = `${Math.max(8, lr.bottom - br.top + 6)}px`
  btn.setAttribute('aria-expanded', 'true')

  const onDown = (e: PointerEvent) => {
    if (!box.isConnected) return closeMenu()
    const t = e.target as Node
    if (!box.contains(t) && !btn.contains(t)) closeMenu()
  }
  // keys typed here stay here: not the chart's shortcuts, and Escape closes the
  // menu, not the dialog (the panel does the same for its own fields)
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key !== 'Escape') return
    e.preventDefault()
    closeMenu()
    btn.focus()
  }
  doc.addEventListener('pointerdown', onDown, true)
  box.addEventListener('keydown', onKey)
  box.addEventListener('keyup', (e) => e.stopPropagation())
  menu = {
    el: box,
    cleanup: () => {
      doc.removeEventListener('pointerdown', onDown, true)
      box.remove()
      btn.setAttribute('aria-expanded', 'false')
    },
  }
}

/** Add the Defaults button to one settings dialog (once). */
function dress(ws: VelaWorkspace, panel: HTMLElement): void {
  if (panel.dataset.cbPr) return
  const foot = panel.querySelector<HTMLElement>(':scope > .vela-dialog-footer')
  if (!foot || !ownerOf(ws, panel)) return
  panel.dataset.cbPr = '1'
  const doc = panel.ownerDocument
  // Vela's own Reset defaults: kept, hidden, for Factory defaults
  const factory = [...foot.querySelectorAll<HTMLButtonElement>('button.vela-dialog-btn')].find((b) => b.textContent?.trim() === 'Reset defaults') ?? null
  if (factory) factory.style.display = 'none'
  const btn = el(doc, 'button', 'vela-dialog-btn cb-pr-btn')
  btn.type = 'button'
  btn.setAttribute('aria-haspopup', 'menu')
  btn.setAttribute('aria-expanded', 'false')
  btn.title = 'Reset, save as your default, or keep these settings under a name'
  btn.append(el(doc, 'span', 'cb-pr-lab', 'Defaults'), el(doc, 'i', 'cb-pr-caret'))
  btn.addEventListener('click', () => (menu && btn.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu(ws, panel, btn, factory)))
  foot.prepend(btn)
}

/** Watch the page for Vela's indicator settings dialog and dress each one. */
export function bindIndicatorPresets(ws: VelaWorkspace): () => void {
  const doc = ws.root.ownerDocument
  const scan = (n: Node) => {
    if (!(n instanceof HTMLElement)) return
    // Vela mounts a dialog as its layer (the positioner) with the panel inside
    if (!n.classList.contains('vela-dialog-positioner') && !n.classList.contains('vela-ind-dialog')) return
    const panel = n.classList.contains('vela-ind-dialog') ? n : n.querySelector<HTMLElement>('.vela-ind-dialog')
    if (panel) dress(ws, panel)
  }
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) scan(n)
  })
  mo.observe(doc.body, { childList: true, subtree: true })
  for (const p of doc.querySelectorAll<HTMLElement>('.vela-ind-dialog')) dress(ws, p)
  return () => {
    mo.disconnect()
    closeMenu()
  }
}
