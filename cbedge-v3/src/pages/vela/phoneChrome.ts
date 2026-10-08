// ─────────────────────────────────────────────────────────────────────────────
// THE PHONE'S CHROME (/m): Brandon, 2026-10-04, the Vela cleanup's phone pass
// (mockup generated/2026-10-04-vela-phone-r1.html; picks A1, B1, C1, D1, and
// "click, hold and push my finger up or down to change the timeframe").
//
//   [ (500) SPX +1.11% ]  5m · RTH   Indicators   Draw   ⋮ More
//
// ── The bar ──────────────────────────────────────────────────────────────────
// Vela's touch bar had eight icon stops (symbol, timeframe, Indicators, Replay,
// Drawings, Maximize, ⋮, chart settings). It stays in the page but hidden
// (`cb-ph-on`, vela.css), and this bar takes its place with five named stops:
//   · the ticker chip: the active chart's icon, ticker and change (the
//     watchlist's quote cache, every 15 s). A tap opens the desktop's ticker
//     picker over the whole screen (symbolPicker.ts openPhonePicker).
//   · the timeframe and session, "5m · RTH". A tap opens the timeframe sheet.
//     PRESS AND HOLD, then slide the finger up or down: a ladder of the
//     timeframes rises over the button (the longer ones at the top), the one
//     the finger has reached is lit (with a tick of the phone's vibration where
//     it has one), and lifting the finger sets it on the active chart. A slide
//     that starts at once, with no hold, does the same. Lifting where it started,
//     or sliding off sideways before it begins, changes nothing.
//   · Indicators, Draw and ⋮ press Vela's own (hidden) stops, so what opens is
//     what opened before: our Indicators dialog, Vela's drawing tools, ⋮.
// Replay, Maximize and Chart settings moved into ⋮.
//
// ── ⋮ More (B1) ──────────────────────────────────────────────────────────────
// Vela's own sheet, regrouped each time it draws, the way the desktop's
// Workspace menu is grouped: the action row (Undo, Redo, Screenshot, plus
// Replay and Maximize), then CHART (Chart type, Layout, Walls opacity, Chart
// settings), PANELS (Watchlist, Data window, Object tree), SCRIPTS · ALERTS (Alerts, Script editor, Strategy Tester, Level
// alerts, Script alerts) and LAYOUT (Setups, Copy indicators). The rows are
// Vela's, moved and renamed, so what each does is unchanged (Chart type, Layout
// and Alerts still open their own pages, with Vela's back row). A row this map
// does not know (a future Vela's, or a new action of ours) lands under MORE at
// the end, never lost.
//
// ── The timeframe sheet (D1) ─────────────────────────────────────────────────
// Vela's, dressed once: the nine date-range chips go (the desktop dropped them
// too), the timeframes come first, then SESSION RTH / ETH, the same switch the
// desktop's timeframe menu carries (sessionClockView.ts), for the active chart.
//
// The charts' one-line cards (A1) are the legend card's phone flavour
// (legend/legendCard.ts), bound by Vela.tsx beside this file. All of this loads
// on the phone build only (Vela.tsx, `phone`).
// ─────────────────────────────────────────────────────────────────────────────

import { iconEl } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { bindPhonePicker, fmtPct, openPhonePicker, toneOf } from '@/pages/vela/symbolPicker'
import { tickerIconEl } from '@/pages/vela/tickerIcon'
import { TIMEFRAMES, tfIndex, tfLabel } from '@/pages/vela/timeframes'
import { wallsOpacity } from '@/pages/vela/wallsOpacity'
import { gexBasisLabel } from '@/pages/vela/gexBasis'
import { normTicker, onWatchlist, quoteOf, refreshQuotes } from '@/pages/vela/watchlist/store'
import { onFeedPrice } from '@/pages/vela/cbedgeProvider'

const QUOTE_MS = 15_000
/** How far the finger travels per timeframe while scrubbing. */
const STEP_PX = 22
/** A press held this long starts the scrub where it is. */
const HOLD_MS = 260
/** Vertical travel that starts the scrub at once (no hold needed). */
const SLOP_PX = 8
/** Sideways travel that gives the press up before the scrub has begun. */
const OFF_PX = 24

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

const setText = (e: Element | null | undefined, t: string) => {
  if (e && e.textContent !== t) e.textContent = t
}

/** RTH / ETH for the active chart, or '' when its symbol has one session. */
function sessionTag(ws: VelaWorkspace): string {
  const c = ws.active
  return c.sessionAvailable ? (c.session === 'extended' ? 'ETH' : 'RTH') : ''
}

function haptic(): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(6)
  } catch {
    /* no vibration motor, or not allowed: the lit row is enough */
  }
}

/** Close one of Vela's sheets the way Esc does (its dialog machine listens for it). */
function closeSheet(body: HTMLElement): void {
  const panel = body.closest<HTMLElement>('.vela-drawer') ?? body
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
}

// ── ⋮: where each of Vela's rows goes ────────────────────────────────────────

type Group = 'chart' | 'panels' | 'alerts' | 'layout'
const GROUPS: ReadonlyArray<{ id: Group; title: string; two: boolean }> = [
  { id: 'chart', title: 'Chart', two: false },
  { id: 'panels', title: 'Panels', two: true },
  { id: 'alerts', title: 'Scripts · Alerts', two: true },
  { id: 'layout', title: 'Layout', two: true },
]
/** Vela's row label → its group and the name it goes by here (in display order). */
const ROWS: ReadonlyArray<{ from: string; group: Group; label?: string; wide?: boolean }> = [
  { from: 'Chart type', group: 'chart' },
  { from: 'Layout', group: 'chart' },
  { from: 'Walls opacity', group: 'chart' },
  { from: 'GEX', group: 'chart', label: 'GEX for every indicator' },
  { from: 'Watchlist', group: 'panels' },
  { from: 'Data window', group: 'panels' },
  { from: 'Object tree', group: 'panels' },
  { from: 'Alerts', group: 'alerts', wide: true },
  { from: 'Scripts', group: 'alerts', label: 'Script editor' },
  { from: 'Strategy Tester', group: 'alerts' },
  { from: 'Level Alerts', group: 'alerts', label: 'Level alerts' },
  { from: 'Script Alerts', group: 'alerts', label: 'Script alerts' },
  { from: 'Setups', group: 'layout' },
  { from: 'Copy indicators to all charts', group: 'layout', label: 'Copy indicators' },
]

export function bindPhoneChrome(ws: VelaWorkspace): () => void {
  const doc = ws.root.ownerDocument
  const offs: Array<() => void> = []
  offs.push(bindPhonePicker(ws))

  /** One of Vela's hidden stops (its click is what ours press). */
  const stop = (sel: string) => ws.root.querySelector<HTMLButtonElement>(`.vela-mobilebar ${sel}`)

  // ── the bar ──
  const bar = el(doc, 'div', 'cb-mbar')
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Chart')

  const sym = el(doc, 'button', 'cb-mb-sym')
  sym.type = 'button'
  const symIc = el(doc, 'span', 'cb-mb-ic')
  const symTk = el(doc, 'b', 'cb-mb-tk')
  const symCh = el(doc, 'span', 'cb-mb-ch')
  sym.append(symIc, symTk, symCh)
  sym.addEventListener('click', () => openPhonePicker())

  const tf = el(doc, 'button', 'cb-mb-tf')
  tf.type = 'button'
  tf.setAttribute('aria-haspopup', 'dialog')
  const tfVal = el(doc, 'b', 'cb-mb-tfv')
  const tfSes = el(doc, 'span', 'cb-mb-ses')
  tf.append(tfVal, tfSes)

  const named = (cls: string, icon: string, label: string, sel: string) => {
    const b = el(doc, 'button', `cb-mb-st ${cls}`)
    b.type = 'button'
    b.setAttribute('aria-label', label)
    b.append(iconEl(icon, doc), el(doc, 'span', '', label))
    b.addEventListener('click', () => stop(sel)?.click())
    return b
  }
  const ind = named('cb-mb-ind', 'indicators', 'Indicators', '.vela-mb-indicators')
  const draw = named('cb-mb-draw', 'pen', 'Draw', '.vela-mb-drawings')
  const more = named('cb-mb-more', 'kebab', 'More', '.vela-mb-more')
  bar.append(sym, tf, ind, draw, more)

  const velaBar = ws.root.querySelector<HTMLElement>(':scope > .vela-mobilebar')
  if (velaBar) velaBar.after(bar)
  else ws.root.append(bar)
  ws.root.classList.add('cb-ph-on')

  // ── painting the bar ──
  let shown: string | null = null
  let iconFor: string | null = null
  let scrubbing = false
  const paint = () => {
    const c = ws.active
    const t = normTicker(c.symbol ?? '')
    if (t !== iconFor) {
      iconFor = t
      symIc.replaceChildren(t ? tickerIconEl(doc, t, 18) : '')
    }
    if (t !== shown) {
      shown = t
      if (t) void refreshQuotes([t])
    }
    const q = t ? quoteOf(t) : undefined
    setText(symTk, t ?? '')
    setText(symCh, fmtPct(q?.pct))
    symCh.dataset.tone = toneOf(q?.pct)
    sym.setAttribute('aria-label', t ? `Ticker ${t}, change ticker` : 'Change ticker')
    if (!scrubbing) setText(tfVal, tfLabel(c.timeframe))
    const ses = sessionTag(ws)
    setText(tfSes, ses ? `· ${ses}` : '')
    tf.setAttribute('aria-label', `Timeframe ${tfLabel(c.timeframe)}${ses ? ` ${ses}` : ''}. Tap for the list; hold and slide up or down to change it`)
    ind.hidden = !stop('.vela-mb-indicators')
    draw.hidden = !stop('.vela-mb-drawings')
  }
  let offMarket: () => void = () => {}
  const follow = () => {
    offMarket()
    offMarket = ws.chart.on('market:changed', paint)
    paint()
  }
  follow()
  offs.push(ws.on('cell:active', follow))
  offs.push(ws.on('state:changed', paint))
  offs.push(ws.on('layout:changed', follow))
  offs.push(onWatchlist(paint))
  // the % beside the ticker follows the chart's own price as it ticks (cbedgeProvider.ts feedPrice)
  offs.push(onFeedPrice(paint))
  offs.push(() => offMarket())
  const quotes = window.setInterval(() => {
    if (!doc.hidden && shown) void refreshQuotes([shown])
  }, QUOTE_MS)
  offs.push(() => clearInterval(quotes))

  // ── the timeframe: a tap opens the sheet, a hold-and-slide scrubs ──
  let ladder: HTMLElement | null = null
  let g: { id: number; x0: number; y0: number; i0: number; i: number; on: boolean; timer: number } | null = null
  // The click a finished scrub (or a slide off sideways) leaves behind is not a tap.
  // Only that one: a browser that sends no click after a drag must not eat the next.
  let swallowClick = false
  let swallowTimer = 0
  const swallowNextClick = () => {
    swallowClick = true
    clearTimeout(swallowTimer)
    swallowTimer = window.setTimeout(() => (swallowClick = false), 400)
  }

  const paintLadder = () => {
    if (!ladder || !g) return
    for (const it of ladder.querySelectorAll<HTMLElement>('.cb-tfl-i')) {
      const i = Number(it.dataset.i)
      it.dataset.on = i === g.i ? '1' : ''
    }
    setText(tfVal, tfLabel(TIMEFRAMES[g.i]!))
  }

  const openLadder = () => {
    ladder?.remove()
    const box = el(doc, 'div', 'cb-tfl')
    box.setAttribute('aria-hidden', 'true')
    box.append(el(doc, 'div', 'cb-tfl-h', 'SLIDE · LIFT TO SET'))
    for (let i = TIMEFRAMES.length - 1; i >= 0; i--) {
      const it = el(doc, 'div', 'cb-tfl-i', tfLabel(TIMEFRAMES[i]!))
      it.dataset.i = String(i)
      if (g && i === g.i0) it.dataset.cur = '1'
      box.append(it)
    }
    doc.body.append(box)
    const r = tf.getBoundingClientRect()
    const vw = doc.documentElement.clientWidth
    const w = box.offsetWidth
    box.style.left = `${Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2))}px`
    box.style.bottom = `${Math.max(8, doc.documentElement.clientHeight - r.top + 8)}px`
    ladder = box
    paintLadder()
  }

  const begin = () => {
    if (!g || g.on) return
    clearTimeout(g.timer)
    g.on = true
    scrubbing = true
    tf.dataset.scrub = '1'
    openLadder()
    haptic()
  }

  const end = () => {
    if (g) clearTimeout(g.timer)
    g = null
    scrubbing = false
    delete tf.dataset.scrub
    ladder?.remove()
    ladder = null
    paint()
  }

  tf.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    swallowClick = false
    const i0 = tfIndex(ws.active.timeframe)
    // a timeframe that is not on the list (a saved document's) can still be tapped
    if (i0 < 0) return
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, i0, i: i0, on: false, timer: window.setTimeout(begin, HOLD_MS) }
    try {
      tf.setPointerCapture(e.pointerId)
    } catch {
      /* capture is a nicety: the moves still reach the button while the finger is on it */
    }
  })
  tf.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return
    const up = g.y0 - e.clientY
    const side = Math.abs(e.clientX - g.x0)
    if (!g.on) {
      if (Math.abs(up) > SLOP_PX && Math.abs(up) >= side) begin()
      else if (side > OFF_PX) {
        clearTimeout(g.timer)
        g = null
        swallowNextClick()
        return
      }
      if (!g.on) return
    }
    const i = Math.max(0, Math.min(TIMEFRAMES.length - 1, g.i0 + Math.round(up / STEP_PX)))
    if (i !== g.i) {
      g.i = i
      paintLadder()
      haptic()
    }
  })
  tf.addEventListener('pointerup', (e) => {
    if (!g || e.pointerId !== g.id) return
    const done = g
    if (done.on) {
      swallowNextClick()
      const next = TIMEFRAMES[done.i]
      end()
      if (next && done.i !== done.i0) ws.active.setTimeframe(next)
    } else {
      clearTimeout(done.timer)
      g = null
    }
  })
  tf.addEventListener('pointercancel', () => {
    if (g?.on) swallowNextClick()
    end()
  })
  // a long press is ours, not the browser's (no callout, no text selection)
  tf.addEventListener('contextmenu', (e) => e.preventDefault())
  tf.addEventListener('click', () => {
    if (swallowClick) {
      swallowClick = false
      return
    }
    // Vela's sheet; it is dressed as it shows (the watch below)
    stop('.vela-mb-tf')?.click()
  })
  offs.push(() => {
    if (g) clearTimeout(g.timer)
    clearTimeout(swallowTimer)
    ladder?.remove()
  })

  // ── Vela's sheets (⋮ and the timeframes), dressed as they draw ──
  const sheets = () => [...ws.root.querySelectorAll<HTMLElement>(':scope > .vela-drawer-positioner .vela-drawer-body')]

  const dressTf = (body: HTMLElement) => {
    const grid = body.querySelector<HTMLElement>(':scope > .vela-tfd-grid')
    if (!grid) return
    if (!body.dataset.cbTf) {
      body.dataset.cbTf = '1'
      body.closest('.vela-drawer')?.classList.add('cb-tfd')
      const ranges = body.querySelector(':scope > .vela-tfd-ranges')
      const rh = ranges?.previousElementSibling
      if (rh?.classList.contains('vela-tfd-heading')) rh.remove()
      ranges?.remove()
      const th = grid.previousElementSibling
      if (th?.classList.contains('vela-tfd-heading')) th.textContent = 'Timeframe'
      const sec = el(doc, 'div', 'cb-tfs')
      const seg = el(doc, 'div', 'cb-tfs-seg')
      seg.setAttribute('role', 'group')
      seg.setAttribute('aria-label', 'Session')
      const opt = (s: 'regular' | 'extended', text: string, title: string) => {
        const b = el(doc, 'button', 'cb-tfs-opt', text)
        b.type = 'button'
        b.dataset.s = s
        b.title = title
        b.addEventListener('click', () => {
          if (b.disabled) return
          if (ws.active.session !== s) ws.active.setSession(s)
          closeSheet(body)
          paint()
        })
        return b
      }
      seg.append(
        opt('regular', 'RTH', 'Regular hours only, 09:30 to 16:00 ET'),
        opt('extended', 'ETH', 'Every session: pre-market, after hours and, on futures, Globex'),
      )
      sec.append(el(doc, 'div', 'vela-tfd-heading', 'Session'), seg, el(doc, 'div', 'cb-tfs-note'))
      body.append(sec)
    }
    const c = ws.active
    const sec = body.querySelector<HTMLElement>(':scope > .cb-tfs')
    if (!sec) return
    sec.dataset.off = c.sessionAvailable ? '' : '1'
    for (const b of sec.querySelectorAll<HTMLButtonElement>('.cb-tfs-opt')) {
      b.disabled = !c.sessionAvailable
      b.setAttribute('aria-pressed', String(c.sessionAvailable && b.dataset.s === c.session))
    }
    setText(
      sec.querySelector('.cb-tfs-note'),
      c.sessionAvailable
        ? 'Regular hours only, or every session (pre-market, after hours and, on futures, Globex). This chart only.'
        : 'One session for this symbol.',
    )
  }

  const tool = (icon: string, label: string, body: HTMLElement, run: () => void) => {
    const b = el(doc, 'button', 'vela-md-action cb-md-tool')
    b.type = 'button'
    b.append(iconEl(icon, doc), doc.createTextNode(label))
    b.addEventListener('click', () => {
      closeSheet(body)
      setTimeout(run, 0)
    })
    return b
  }

  const ourRow = (icon: string, label: string, body: HTMLElement, run: () => void) => {
    const r = el(doc, 'div', 'vela-md-row cb-md-row')
    r.setAttribute('role', 'button')
    r.tabIndex = 0
    r.append(iconEl(icon, doc), el(doc, 'span', 'vela-md-row-label', label))
    const go = () => {
      closeSheet(body)
      setTimeout(run, 0)
    }
    r.addEventListener('click', go)
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        go()
      }
    })
    return r
  }

  const dressMore = (body: HTMLElement) => {
    const list = body.querySelector<HTMLElement>(':scope > .vela-md-list')
    // the main page only (Chart type, Layout and Alerts draw a back row first)
    if (!list || list.dataset.cb || body.querySelector(':scope > .vela-md-back')) return
    if (!list.querySelector(':scope > .vela-md-row')) return
    list.dataset.cb = '1'
    body.closest('.vela-drawer')?.classList.add('cb-mdr')

    // the action row: Vela's Undo / Redo / Screenshot, then Replay and Maximize
    let acts = body.querySelector<HTMLElement>(':scope > .vela-md-actions')
    if (!acts) {
      acts = el(doc, 'div', 'vela-md-actions')
      body.insertBefore(acts, list)
    }
    const replay = stop('.vela-mb-actions button[aria-label="Replay"]')
    if (replay) acts.append(tool('replay', 'Replay', body, () => replay.click()))
    const max = stop('.vela-mb-maximize')
    if (max && !max.hidden) {
      const on = max.classList.contains('vela-mb-on')
      acts.append(tool(on ? 'restore' : 'maximize', on ? 'Restore' : 'Maximize', body, () => max.click()))
    }

    // the rows, by the name Vela gave them
    const byLabel = new Map<string, HTMLElement>()
    for (const r of list.querySelectorAll<HTMLElement>(':scope > .vela-md-row')) {
      byLabel.set(r.querySelector('.vela-md-row-label')?.textContent?.trim() ?? '', r)
    }
    const groups = new Map<Group, { wide: HTMLElement[]; rows: HTMLElement[] }>()
    for (const G of GROUPS) groups.set(G.id, { wide: [], rows: [] })
    for (const R of ROWS) {
      const r = byLabel.get(R.from)
      if (!r) continue
      byLabel.delete(R.from)
      r.classList.add('cb-md-row')
      if (R.label) setText(r.querySelector('.vela-md-row-label'), R.label)
      if (R.from === 'GEX') {
        r.append(el(doc, 'span', 'vela-md-row-value', gexBasisLabel()))
      }
      if (R.from === 'Walls opacity') {
        const v = el(doc, 'span', 'vela-md-row-value', `${Math.round(wallsOpacity() * 100)}%`)
        r.append(v)
      }
      const g = groups.get(R.group)!
      ;(R.wide ? g.wide : g.rows).push(r)
    }
    groups.get('chart')!.rows.push(ourRow('gear', 'Chart settings', body, () => ws.active.chart.renderer.openSettings()))

    const out: HTMLElement[] = []
    const section = (title: string, wide: HTMLElement[], rows: HTMLElement[], two: boolean) => {
      if (!wide.length && !rows.length) return
      const sec = el(doc, 'div', 'cb-md-sec')
      sec.append(el(doc, 'div', 'cb-md-h', title.toUpperCase()), ...wide)
      if (rows.length) {
        const box = el(doc, 'div', two ? 'cb-md-two' : 'cb-md-one')
        box.append(...rows)
        sec.append(box)
      }
      out.push(sec)
    }
    for (const G of GROUPS) {
      const g = groups.get(G.id)!
      section(G.title, g.wide, g.rows, G.two)
    }
    // desktop only (Brandon, 2026-10-07: "no mobile for this"): Volt watch's row is dropped
    byLabel.delete('Volt watch')
    // anything this map does not know yet: kept, at the end
    const rest = [...byLabel.values()]
    for (const r of rest) r.classList.add('cb-md-row')
    section('More', [], rest, false)
    list.replaceChildren(...out)
  }

  const dress = (body: HTMLElement) => {
    dressTf(body)
    dressMore(body)
  }

  // Vela builds each sheet on its first open (appended to the workspace root) and
  // redraws ⋮ on every open and page change: watch for both.
  const watched = new WeakSet<HTMLElement>()
  const bodyMos: MutationObserver[] = []
  const scan = () => {
    for (const body of sheets()) {
      if (watched.has(body)) continue
      watched.add(body)
      const positioner = body.closest<HTMLElement>('.vela-drawer-positioner')
      const mo = new MutationObserver(() => dress(body))
      mo.observe(body, { childList: true })
      // shown / hidden: Vela flips the positioner's display
      if (positioner) mo.observe(positioner, { attributes: true, attributeFilter: ['style'] })
      bodyMos.push(mo)
      dress(body)
    }
  }
  const rootMo = new MutationObserver(scan)
  rootMo.observe(ws.root, { childList: true })
  scan()
  offs.push(() => {
    rootMo.disconnect()
    for (const mo of bodyMos) mo.disconnect()
  })

  return () => {
    for (const off of offs) off()
    bar.remove()
    ws.root.classList.remove('cb-ph-on')
  }
}
