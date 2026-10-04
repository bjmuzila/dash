// ─────────────────────────────────────────────────────────────────────────────
// A dropdown in the app's own theme, for the Vela page's panels. A native
// <select> opens the OPERATING SYSTEM's list — white with a blue highlight on
// Windows, whatever the page looks like — so the Watchlist's list picker, the
// Scripts panel's saved-script picker and the Strategy Tester's strategy picker
// use this instead: a button that opens a themed list.
//
//   · the list is fixed to the page (it escapes a panel header's clipping),
//     under the button, flipped above it when there is no room below
//   · keyboard: ↑ ↓ Home End move, Enter / Space picks, Escape / Tab closes;
//     type a letter to jump to the next option that starts with it
//   · closes on a pick, a click outside, scroll of anything but the list,
//     or a resize
//   · an option can be an ACTION (`action: true` — "+ New watchlist"): picking
//     it calls onChange with its value but never becomes the shown value
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string
  label: string
  /** Muted text after the label (a count, a symbol). */
  hint?: string
  /** A command row, not a value (drawn apart, never "selected"). */
  action?: boolean
}

export class ThemedSelect {
  readonly el: HTMLButtonElement
  /** Picked by the user (also for an action row). */
  onChange: ((value: string) => void) | null = null
  private opts: SelectOption[] = []
  private cur = ''
  private readonly text: HTMLSpanElement
  private menu: HTMLDivElement | null = null
  private active = -1
  private readonly doc: Document
  private readonly offs: (() => void)[] = []

  constructor(doc: Document, cls: string, label: string) {
    this.doc = doc
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `cb-sel ${cls}`
    b.setAttribute('aria-haspopup', 'listbox')
    b.setAttribute('aria-expanded', 'false')
    b.setAttribute('aria-label', label)
    this.text = doc.createElement('span')
    this.text.className = 'cb-sel-text'
    const caret = doc.createElement('span')
    caret.className = 'cb-sel-caret'
    caret.setAttribute('aria-hidden', 'true')
    caret.textContent = '▾'
    b.append(this.text, caret)
    b.addEventListener('click', () => (this.menu ? this.close() : this.open()))
    b.addEventListener('keydown', (e) => {
      if (!this.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        e.stopPropagation()
        this.open()
      } else if (this.menu) {
        // the chart's own shortcuts listen above every panel
        e.stopPropagation()
        this.onKey(e)
      }
    })
    this.el = b
  }

  get value(): string {
    return this.cur
  }
  set value(v: string) {
    this.cur = v
    this.paint()
  }

  setOptions(opts: SelectOption[], value?: string): void {
    this.opts = opts
    if (value != null) this.cur = value
    this.paint()
    if (this.menu) this.renderMenu()
  }

  private paint(): void {
    const o = this.opts.find((x) => x.value === this.cur && !x.action)
    this.text.textContent = o ? (o.hint ? `${o.label} (${o.hint})` : o.label) : ''
    this.el.disabled = !this.opts.length
  }

  private open(): void {
    if (this.menu || !this.opts.length) return
    const m = this.doc.createElement('div')
    m.className = 'cb-sel-menu'
    m.style.cssText = 'position:fixed;left:0;top:0;z-index:90' // never in the page flow
    m.setAttribute('role', 'listbox')
    this.menu = m
    this.active = Math.max(0, this.opts.findIndex((o) => o.value === this.cur && !o.action))
    this.renderMenu()
    this.doc.body.appendChild(m)
    this.place()
    this.el.setAttribute('aria-expanded', 'true')
    const outside = (e: Event) => {
      const t = e.target as Node
      if (!m.contains(t) && !this.el.contains(t)) this.close()
    }
    const scroll = (e: Event) => {
      if (!m.contains(e.target as Node)) this.close()
    }
    const resize = () => this.close()
    this.doc.addEventListener('pointerdown', outside, true)
    this.doc.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    this.offs.push(
      () => this.doc.removeEventListener('pointerdown', outside, true),
      () => this.doc.removeEventListener('scroll', scroll, true),
      () => window.removeEventListener('resize', resize),
    )
  }

  close(): void {
    for (const off of this.offs.splice(0)) off()
    this.menu?.remove()
    this.menu = null
    this.el.setAttribute('aria-expanded', 'false')
  }

  destroy(): void {
    this.close()
  }

  private renderMenu(): void {
    const m = this.menu
    if (!m) return
    m.replaceChildren()
    let lastAction = false
    this.opts.forEach((o, i) => {
      if (o.action && !lastAction && i > 0) {
        const sep = this.doc.createElement('div')
        sep.className = 'cb-sel-sep'
        m.append(sep)
      }
      lastAction = !!o.action
      const row = this.doc.createElement('div')
      row.className = 'cb-sel-opt'
      row.setAttribute('role', 'option')
      if (o.action) row.dataset.action = '1'
      if (!o.action && o.value === this.cur) {
        row.setAttribute('aria-selected', 'true')
        row.dataset.cur = '1'
      }
      if (i === this.active) row.dataset.active = '1'
      const l = this.doc.createElement('span')
      l.className = 'cb-sel-label'
      l.textContent = o.label
      row.append(l)
      if (o.hint) {
        const h = this.doc.createElement('span')
        h.className = 'cb-sel-hint'
        h.textContent = o.hint
        row.append(h)
      }
      row.addEventListener('pointerenter', () => this.setActive(i, false))
      row.addEventListener('click', () => this.pick(i))
      m.append(row)
    })
  }

  private place(): void {
    const m = this.menu
    if (!m) return
    const r = this.el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(Math.max(r.width, 200), vw - 16)
    m.style.minWidth = `${w}px`
    const h = m.offsetHeight
    const below = vh - r.bottom - 8
    const top = h <= below || r.top < h + 8 ? r.bottom + 4 : r.top - 4 - h
    const left = Math.max(8, Math.min(r.left, vw - m.offsetWidth - 8))
    m.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, top))}px)`
    m.style.maxHeight = `${Math.max(120, top > r.top ? vh - top - 8 : r.top - 12)}px`
  }

  private setActive(i: number, scroll: boolean): void {
    this.active = i
    const rows = this.menu?.querySelectorAll<HTMLElement>('.cb-sel-opt')
    rows?.forEach((r, k) => (k === i ? (r.dataset.active = '1') : delete r.dataset.active))
    if (scroll) rows?.[i]?.scrollIntoView({ block: 'nearest' })
  }

  private pick(i: number): void {
    const o = this.opts[i]
    this.close()
    this.el.focus()
    if (!o) return
    if (!o.action) {
      if (o.value === this.cur) return
      this.cur = o.value
      this.paint()
    }
    this.onChange?.(o.value)
  }

  private onKey(e: KeyboardEvent): void {
    const n = this.opts.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      this.setActive((this.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n, true)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      this.setActive(e.key === 'Home' ? 0 : n - 1, true)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.pick(this.active)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      this.close()
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase()
      for (let s = 1; s <= n; s++) {
        const j = (this.active + s) % n
        if (this.opts[j]!.label.toLowerCase().startsWith(k)) {
          this.setActive(j, true)
          break
        }
      }
    }
  }
}
