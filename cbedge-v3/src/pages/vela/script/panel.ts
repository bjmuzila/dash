// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the Scripts panel: write, save, add to a chart. And keep it there.
//
// A Vela SIDE PANEL (registerSidePanel): on desktop its button sits in the
// topbar's panel group beside the object tree and data window and it docks as
// a column; on a phone it is a row in ⋮. Inside:
//
//   [ saved scripts ▾ ] [New] [Delete]
//   name
//   ┌ editor ─────────────────────────────┐   Tab indents · Ctrl/⌘+Enter saves
//   └─────────────────────────────────────┘
//   [Save] [Add to chart]   status / the error, with its line
//   ▸ Reference
//
//   Save          checks the script (engine.compile — parse + a dry run, so a
//                 typo is caught here, not on a chart), stores it in the library,
//                 and updates every chart already running it, in place
//                 (IndicatorHandle.updateCode — same row, inputs kept). Anything
//                 the script does that is skipped (drawings, strategy orders) is
//                 said on the status line.
//   Paste         a TradingView Pine script pasted over the whole editor becomes a
//                 NEW script named after its indicator() title — the one that was
//                 showing is not overwritten.
//   Add to chart  saves, then adds it to the ACTIVE chart through the shell
//                 (WidgetContext.addIndicator — on the undo timeline, counted on
//                 the topbar) with the id `cbs-<library id>-<n>`
//
// ── Staying on the chart ─────────────────────────────────────────────────────
// Vela persists the indicators IT lists (built-ins, manifest entries); a script
// added through the shell is the plugin's to keep. registerStatePersistence
// (key `cbedge.scripts`, per chart): serialize every `cbs-` instance — its
// source, input values and hidden flag — into the chart's saved state; restore
// re-adds them on load, taking the LIBRARY's latest source when the script is
// still saved (so an edit made on another chart lands) and the chart's own copy
// when it is not.
// ─────────────────────────────────────────────────────────────────────────────

import { registerSidePanel, registerStatePersistence, type WidgetContext } from '@luxalgo/vela'
import type { WorkspaceWidgetContext } from '@luxalgo/vela/workspace'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { CBSCRIPT, compile } from './engine'
import { instanceIdFor, libIdOf, loadLibrary, newScriptId, saveLibrary, TEMPLATE, type Script } from './library'

const PANEL_ID = 'cbedge-scripts'
const PERSIST_KEY = 'cbedge.scripts'

const REFERENCE = `PINE SCRIPT  paste a TradingView indicator as is (v4, v5, v6)
  Runs per bar the way TradingView does: var, x[1], if / for / while /
  switch, your own functions f(x) =>, tuples [a, b] = …, ta.* math.*
  str.* color.* input.*, plot plotshape plotchar plotarrow hline fill
  bgcolor barcolor.
  Not yet: request.security, arrays / maps, drawings (label.new,
  line.new, box.new are skipped), strategy orders (plots only).

CB SCRIPT  the same language, plus
  input("Length", 20, min=1)                      title first
  plot(x, "EMA", color=gold, width=2, dashed=true)
  marker(cond, "text", position="below", color=green, shape="triangleup")
  bgcolor(cond, color=red, opacity=0.1)
  fill(p1, p2, color=blue, opacity=0.15)
  bb_upper / bb_lower (src, len, mult)    alpha(color, 0.5)

SERIES   open high low close volume hl2 hlc3 ohlc4 time bar_index
TA       sma ema rma wma vwma hma alma · rsi macd stoch cci atr mfi wpr
         bb kc dmi supertrend sar · highest lowest sum change roc mom
         stdev linreg pivothigh pivotlow vwap obv · crossover crossunder
         cross barssince valuewhen rising falling
COLORS   color.red … · "#rrggbb" · color.new  color.rgb  color.from_gradient
         CB names: green red blue gold orange purple pink teal gray
         white call put core volt surge reversal coil`

/** The title a pasted script declares — indicator("…") / study("…") / strategy("…"). */
function declaredTitle(src: string): string | null {
  const m = /\b(?:indicator|study|strategy)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/.exec(src)
  return m ? m[2]!.trim() || null : null
}

/** The cells a context can see (the workspace context lists them all). */
function chartsOf(ctx: WidgetContext) {
  const cells = (ctx as Partial<WorkspaceWidgetContext>).cells
  return cells ? cells.map((c) => c.chart) : [ctx.chart]
}

/** Every chart instance of a library script gets the new source, in place. */
function updateRunning(ctx: WidgetContext, lib: Script): number {
  let n = 0
  for (const chart of chartsOf(ctx)) {
    for (const h of chart.indicators()) {
      if (libIdOf(h.id) !== lib.id) continue
      if (h.source !== lib.source) h.updateCode(lib.source)
      n++
    }
  }
  if (n) ctx.stateChanged()
  return n
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

function mountPanel(ctx: WidgetContext, body: HTMLElement) {
  const doc = body.ownerDocument
  body.classList.add('cb-scr')
  // Keystrokes stay in the editor — Vela's chart shortcuts (type-to-search,
  // Ctrl/Cmd+Z, Delete …) listen above this panel.
  for (const t of ['keydown', 'keyup', 'keypress'] as const) body.addEventListener(t, (e) => e.stopPropagation())

  let lib = loadLibrary()
  let cur: Script = lib[0] ? { ...lib[0] } : { id: newScriptId(), name: 'My script', source: TEMPLATE }
  let dirty = false
  let armedDelete = false

  const pickRow = el(doc, 'div', 'cb-scr-row')
  const pick = el(doc, 'select', 'cb-scr-pick')
  pick.setAttribute('aria-label', 'Saved scripts')
  const btnNew = el(doc, 'button', 'cb-scr-btn', 'New')
  const btnDel = el(doc, 'button', 'cb-scr-btn', 'Delete')
  pickRow.append(pick, btnNew, btnDel)

  const name = el(doc, 'input', 'cb-scr-name')
  name.type = 'text'
  name.placeholder = 'Script name'
  name.setAttribute('aria-label', 'Script name')

  const code = el(doc, 'textarea', 'cb-scr-code')
  code.spellcheck = false
  code.setAttribute('autocapitalize', 'off')
  code.setAttribute('autocomplete', 'off')
  code.setAttribute('aria-label', 'Script')
  code.placeholder = 'Paste a TradingView Pine script, or write CB Script'

  const actRow = el(doc, 'div', 'cb-scr-row')
  const btnSave = el(doc, 'button', 'cb-scr-btn cb-scr-primary', 'Save')
  const btnAdd = el(doc, 'button', 'cb-scr-btn', 'Add to chart')
  actRow.append(btnSave, btnAdd)
  const status = el(doc, 'div', 'cb-scr-status')
  status.setAttribute('role', 'status')

  const ref = el(doc, 'details', 'cb-scr-ref')
  const sum = el(doc, 'summary', '', 'Reference')
  const pre = el(doc, 'pre', 'cb-scr-pre', REFERENCE)
  ref.append(sum, pre)

  body.append(pickRow, name, code, actRow, status, ref)

  const say = (text: string, kind: 'ok' | 'err' | 'info' = 'info') => {
    status.textContent = text
    status.dataset.kind = kind
  }
  const fillPick = () => {
    pick.replaceChildren()
    const known = lib.some((s) => s.id === cur.id)
    for (const s of known ? lib : [...lib, cur]) {
      const o = doc.createElement('option')
      o.value = s.id
      o.textContent = known || s.id !== cur.id ? s.name : `${s.name} (unsaved)`
      pick.append(o)
    }
    pick.value = cur.id
  }
  const show = (s: Script) => {
    cur = { ...s }
    name.value = s.name
    code.value = s.source
    dirty = false
    armedDelete = false
    btnDel.textContent = 'Delete'
    fillPick()
  }
  const read = (): Script => ({ id: cur.id, name: name.value.trim() || 'Untitled', source: code.value })

  /** Check + store. Returns the saved script, or null (and says why). */
  const save = (): Script | null => {
    const s = read()
    let warnings: string[] = []
    try {
      const { result } = compile(s.source)
      warnings = result.warnings
      const saved = lib.find((x) => x.id === s.id)
      const was = saved ? declaredTitle(saved.source) : null
      // a name that was just the old title follows the new one
      if (result.meta.title && (!name.value.trim() || name.value.trim() === 'Pasted script' || (was && name.value.trim() === was))) s.name = result.meta.title
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), 'err')
      return null
    }
    const i = lib.findIndex((x) => x.id === s.id)
    lib = i >= 0 ? lib.map((x, k) => (k === i ? s : x)) : [...lib, s]
    saveLibrary(lib)
    cur = { ...s }
    name.value = s.name
    dirty = false
    fillPick()
    const n = updateRunning(ctx, s)
    const note = warnings.length ? `\nNote: ${warnings.join('; ')}` : ''
    say((n ? `Saved — updated on ${n} chart${n === 1 ? '' : 's'}` : 'Saved') + note, 'ok')
    return s
  }

  btnSave.addEventListener('click', () => void save())
  btnAdd.addEventListener('click', () => {
    const s = save()
    if (!s) return
    ctx.addIndicator({ name: s.name, script: s.source, language: CBSCRIPT, id: instanceIdFor(s.id) })
    say(`Added “${s.name}” to the chart${status.textContent?.includes('\nNote:') ? status.textContent.slice(status.textContent.indexOf('\nNote:')) : ''}`, 'ok')
  })
  btnNew.addEventListener('click', () => {
    show({ id: newScriptId(), name: 'My script', source: TEMPLATE })
    say('New script — Save to keep it', 'info')
    code.focus()
  })
  btnDel.addEventListener('click', () => {
    if (!lib.some((s) => s.id === cur.id)) {
      show(lib[0] ?? { id: newScriptId(), name: 'My script', source: TEMPLATE })
      return
    }
    if (!armedDelete) {
      armedDelete = true
      btnDel.textContent = 'Confirm delete'
      return
    }
    lib = lib.filter((s) => s.id !== cur.id)
    saveLibrary(lib)
    show(lib[0] ?? { id: newScriptId(), name: 'My script', source: TEMPLATE })
    say('Deleted — charts running it keep their copy', 'info')
  })
  pick.addEventListener('change', () => {
    const s = lib.find((x) => x.id === pick.value)
    if (s) {
      show(s)
      say('', 'info')
    }
  })
  const touched = () => {
    dirty = true
    if (armedDelete) {
      armedDelete = false
      btnDel.textContent = 'Delete'
    }
  }
  name.addEventListener('input', touched)
  code.addEventListener('input', touched)
  code.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    const whole = code.selectionStart === 0 && code.selectionEnd === code.value.length
    if (!text.trim() || !(whole || !code.value.trim())) return
    // the whole editor replaced: a new script, not an edit of the one showing
    e.preventDefault()
    const source = text.replace(/\r\n?/g, '\n')
    let t = declaredTitle(source)
    try {
      t = compile(source).result.meta.title || t // the declared title, however its arguments are spelled
    } catch {
      /* Save will say what is wrong */
    }
    show({ id: newScriptId(), name: t ?? 'Pasted script', source })
    dirty = true
    say('Pasted as a new script — Save to keep it, or Add to chart', 'info')
  })
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const a = code.selectionStart
      const b = code.selectionEnd
      code.setRangeText('    ', a, b, 'end') // Pine blocks are 4 spaces
      touched()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void save()
    }
  })

  show(cur)
  say('Write a script or paste a TradingView one, Save, then Add to chart', 'info')
  return {
    onOpen() {
      // another tab or chart may have saved meanwhile
      if (!dirty) {
        lib = loadLibrary()
        const s = lib.find((x) => x.id === cur.id)
        if (s) show(s)
        else fillPick()
      }
    },
  }
}

interface Persisted {
  id: string
  name: string
  script: string
  inputs?: Record<string, number | string | boolean>
  hidden?: boolean
}

let registered = false

/** The panel, its icon and the per-chart persistence. Once; before any workspace is built. */
export function registerScripts(): void {
  if (registered) return
  registered = true
  // </> — code
  registerIcon('cb-script', svg16('<path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 2.5 7 13.5"/>'))
  registerSidePanel({
    id: PANEL_ID,
    title: 'Scripts',
    icon: 'cb-script',
    width: 420,
    resizable: true,
    minWidth: 320,
    maxWidth: 760,
    mount: (ctx, body, header) => {
      header.setTitle('CB Script')
      return mountPanel(ctx, body)
    },
  })
  registerStatePersistence({
    key: PERSIST_KEY,
    scope: 'cell',
    serialize: (ctx) => {
      const out: Persisted[] = []
      for (const h of ctx.chart.indicators()) {
        if (!h.id.startsWith('cbs-') || !h.source) continue
        out.push({ id: h.id, name: h.title, script: h.source, inputs: h.inputValues(), ...(h.visible ? {} : { hidden: true }) })
      }
      return out.length ? out : undefined
    },
    restore: (payload, ctx) => {
      if (!Array.isArray(payload)) return
      const lib = new Map(loadLibrary().map((s) => [s.id, s]))
      const live = new Set(ctx.chart.indicators().map((h) => h.id))
      for (const raw of payload as unknown[]) {
        const p = raw as Partial<Persisted>
        if (!p || typeof p.id !== 'string' || !p.id.startsWith('cbs-') || typeof p.script !== 'string') continue
        if (live.has(p.id)) continue
        const saved = lib.get(libIdOf(p.id) ?? '')
        ctx.addIndicator({
          name: typeof p.name === 'string' ? p.name : saved?.name ?? 'Script',
          script: saved?.source ?? p.script,
          language: CBSCRIPT,
          id: p.id,
          ...(p.inputs && typeof p.inputs === 'object' ? { inputs: p.inputs } : {}),
          ...(p.hidden ? { hidden: true } : {}),
        })
      }
    },
  })
}
