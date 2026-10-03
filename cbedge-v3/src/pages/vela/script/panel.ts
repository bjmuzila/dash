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
//                 (IndicatorHandle.updateCode — same row, inputs kept)
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

const REFERENCE = `SERIES   open high low close volume hl2 hlc3 ohlc4 time bar_index
AVERAGE  sma ema rma wma vwma hma (src, length)
BANDS    bb_upper bb_lower (src, length, mult)   stdev (src, length)
RANGE    highest lowest sum (src, length)   change roc (src, length=1)
MOMENTUM rsi (src, len)  macd (src, fast, slow)  cci (src, len)
         stoch (len)  atr (len)  tr()  obv()  vwap()  cum (src)
SIGNALS  crossover crossunder cross (a, b)   rising falling (src, len)
         barssince (cond)   valuewhen (cond, src)
MATH     abs sqrt log exp sign floor ceil round pow min max avg
         nz (x, 0)  na (x)  fixnan (x)
HISTORY  close[1] = the bar before
LOGIC    and or not   == != < <= > >=   cond ? a : b

indicator("Title", overlay=true)
x = input("Length", 20, min=1, max=200, step=1)
src = input("Source", close)          mode = input("Mode", "EMA", options=["EMA", "SMA"])
p = plot(series, "Title", color=gold, width=2, style="line", dashed=false)
     style: line step histogram area columns circles cross
hline(70, "Level", color=red, style="dashed")
fill(p1, p2, color=blue, opacity=0.1)
marker(cond, "text", position="below", color=green, shape="triangleup", size="small")
     shape: triangleup triangledown arrowup arrowdown circle square diamond
            flag cross xcross none (text only)
bgcolor(cond, color=red, opacity=0.1)

COLORS   green red blue gold yellow orange purple pink teal gray white
         call put core volt surge reversal coil   or "#rrggbb"
         close > open ? green : red   (per bar)`

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
    try {
      const { result } = compile(s.source)
      if (!name.value.trim() && result.meta.title) s.name = result.meta.title
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
    say(n ? `Saved — updated on ${n} chart${n === 1 ? '' : 's'}` : 'Saved', 'ok')
    return s
  }

  btnSave.addEventListener('click', () => void save())
  btnAdd.addEventListener('click', () => {
    const s = save()
    if (!s) return
    ctx.addIndicator({ name: s.name, script: s.source, language: CBSCRIPT, id: instanceIdFor(s.id) })
    say(`Added “${s.name}” to the chart`, 'ok')
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
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const a = code.selectionStart
      const b = code.selectionEnd
      code.setRangeText('  ', a, b, 'end')
      touched()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void save()
    }
  })

  show(cur)
  say('Write a script, Save, then Add to chart', 'info')
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
