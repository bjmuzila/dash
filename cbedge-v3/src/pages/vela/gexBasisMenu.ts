// ─────────────────────────────────────────────────────────────────────────────
// THE GEX SWITCH'S BUTTON (gexBasis.ts has the why).
//
//   … | Indicators | GEX · Vol ▾ | Replay | …
//
// Desktop: a top-bar button beside Indicators, always naming the book every
// indicator is on. A click drops a small menu under it:
//
//   GEX FOR EVERY INDICATOR
//   OI only     open interest GEX
//   OI + Vol    open interest plus today's volume
//   Vol only    today's volume alone             ✓
//   LEVELS
//   Coil: on    ½ the Volt or more               ✓   (gexBasis.ts vtCoilOn)
//
// A pick applies to every chart at once and the menu closes. ↑ ↓ move, Enter or
// Space picks, Esc closes. Phone: a ⋮ row (phoneChrome.ts shows the book on it)
// that opens the same menu centred.
//
// Registered before the workspace is built (Vela reads its widget-action
// registry then); bindGexBasis() dresses the button once the bar exists and
// re-dresses it if Vela rebuilds the bar.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { iconEl, registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { GEX_BASES, gexBasis, gexBasisLabel, gexBasisShort, onGexBasis, setGexBasis, setVtCoil, vtCoilOn } from '@/pages/vela/gexBasis'

export const GEX_BASIS_ACTION_ID = 'cb-gex-basis'
/** What the button is called before it is dressed, and the ⋮ row's name on a phone. */
export const GEX_BASIS_LABEL = 'GEX'

let menu: { el: HTMLElement; close: () => void } | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** Our button in the bar: dressed already, or Vela's fresh one still reading GEX. */
function buttonOf(root: ParentNode): HTMLButtonElement | null {
  const dressed = root.querySelector<HTMLButtonElement>('.vela-widget-topbar button.cb-gexb')
  if (dressed) return dressed
  for (const b of root.querySelectorAll<HTMLButtonElement>('.vela-widget-topbar button')) {
    if (b.textContent?.trim() === GEX_BASIS_LABEL) return b
  }
  return null
}

function toggleMenu(anchor: HTMLElement | null): void {
  if (menu) {
    menu.close()
    return
  }
  const box = el('div', 'cb-wsm cb-gexm')
  box.setAttribute('role', 'menu')
  box.setAttribute('aria-label', 'GEX for every indicator')
  box.style.cssText = 'position:fixed;z-index:80'
  document.body.appendChild(box)
  anchor?.setAttribute('aria-expanded', 'true')
  anchor?.setAttribute('data-open', '1')

  const place = () => {
    const w = Math.min(340, window.innerWidth - 16)
    box.style.width = `${w}px`
    const r = anchor?.getBoundingClientRect()
    if (r && r.width > 0) {
      box.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`
      box.style.top = `${r.bottom + 6}px`
    } else {
      box.style.left = `${Math.max(8, (window.innerWidth - w) / 2)}px`
      box.style.top = `${Math.max(60, window.innerHeight / 3)}px`
    }
  }

  const rows: HTMLButtonElement[] = []
  const group = el('div', 'cb-wsm-group')
  group.append(el('div', 'cb-wsm-h', 'GEX for every indicator'))
  for (const o of GEX_BASES) {
    const on = o.key === gexBasis()
    const b = el('button', 'cb-wsm-row')
    b.type = 'button'
    b.setAttribute('role', 'menuitemradio')
    b.setAttribute('aria-checked', on ? 'true' : 'false')
    b.title = o.hint
    if (on) b.dataset.on = '1'
    const right = el('span', 'cb-wsm-right')
    right.append(el('span', 'cb-gexm-hint', o.hint.split(':')[0]!))
    right.append(el('span', 'cb-wsm-check', on ? '✓' : ''))
    b.append(el('span', 'cb-wsm-label', o.label), right)
    b.addEventListener('click', () => {
      close()
      setGexBasis(o.key)
    })
    rows.push(b)
    group.append(b)
  }
  // THE COIL SWITCH (gexBasis.ts vtCoilOn): Coils named or not, on every chart
  const lv = el('div', 'cb-wsm-group')
  lv.append(el('div', 'cb-wsm-h', 'Levels'))
  {
    const on = vtCoilOn()
    const b = el('button', 'cb-wsm-row')
    b.type = 'button'
    b.setAttribute('role', 'menuitemcheckbox')
    b.setAttribute('aria-checked', on ? 'true' : 'false')
    b.title = 'Coil: every level at least half the Volt’s size (not the Volt, Reversal or Surge). Click to turn on or off'
    const right = el('span', 'cb-wsm-right')
    right.append(el('span', 'cb-gexm-hint', '½ the Volt or more'))
    right.append(el('span', 'cb-wsm-check', on ? '✓' : ''))
    b.append(el('span', 'cb-wsm-label', on ? 'Coil: on' : 'Coil: off'), right)
    b.addEventListener('click', () => {
      close()
      setVtCoil(!vtCoilOn())
    })
    rows.push(b)
    lv.append(b)
  }
  const grid = el('div', 'cb-wsm-grid')
  grid.append(group, lv)
  box.append(grid)
  place()

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      anchor?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    const n = rows.length
    rows[e.key === 'ArrowDown' ? (i + 1 + n) % n : (i - 1 + n) % n]?.focus()
  }
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node | null
    if (t && (box.contains(t) || anchor?.contains(t))) return
    close()
  }
  const close = () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('resize', place)
    box.remove()
    anchor?.removeAttribute('aria-expanded')
    anchor?.removeAttribute('data-open')
    menu = null
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onDown, true)
  window.addEventListener('resize', place)
  menu = { el: box, close }
  ;(rows.find((r) => r.dataset.on === '1') ?? rows[0])?.focus()
}

let registered = false

/** The button. Once; before any workspace is built. */
export function registerGexBasis(): void {
  if (registered) return
  registered = true
  // three stacked bars of different lengths: a GEX ladder
  registerIcon('cb-gex', svg16('<path d="M3 4h7M3 8h10M3 12h5"/>'))
  registerWidgetAction({
    id: GEX_BASIS_ACTION_ID,
    target: 'topbar',
    label: GEX_BASIS_LABEL,
    icon: 'cb-gex',
    mobile: 'menu',
    run: (ctx: WidgetContext) => toggleMenu(buttonOf(ctx.host)),
  })
}

/** Dress the desktop button as `GEX · Vol ▾`, and keep it dressed. Returns the unbind. */
export function bindGexBasis(ws: VelaWorkspace): () => void {
  const paint = () => {
    const b = buttonOf(ws.root)
    if (!b) return
    let val = b.querySelector<HTMLElement>(':scope > .cb-gexb-val')
    if (!b.classList.contains('cb-gexb') || !val) {
      b.classList.add('cb-gexb')
      b.setAttribute('aria-haspopup', 'menu')
      const icon = iconEl('cb-gex')
      icon.classList.add('cb-gexb-icon')
      val = el('span', 'cb-gexb-val')
      b.replaceChildren(icon, el('span', 'cb-gexb-name', GEX_BASIS_LABEL), val, el('span', 'cb-gexb-caret', '▾'))
    }
    const short = gexBasisShort()
    if (val.textContent !== short) val.textContent = short
    const tip = `GEX for every indicator: ${gexBasisLabel()}. Click to change`
    if (b.title !== tip) b.title = tip
    b.setAttribute('aria-label', tip)
  }
  paint()
  const bar = ws.root.querySelector('.vela-widget-topbar') ?? ws.root
  const mo = new MutationObserver(() => {
    const b = buttonOf(ws.root)
    if (b && (!b.classList.contains('cb-gexb') || !b.querySelector('.cb-gexb-val'))) paint()
  })
  mo.observe(bar, { childList: true, subtree: true })
  const off = onGexBasis(paint)
  return () => {
    mo.disconnect()
    off()
    menu?.close()
  }
}
