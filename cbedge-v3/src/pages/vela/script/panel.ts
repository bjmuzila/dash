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
//   CB Edge levels  this week's EM & levels script for the active chart's
//                 symbol, straight from /api/pinescript (the Pine the levels
//                 page hands out for TradingView), saved as `cbl-<symbol>` and
//                 put on the chart — again later to refresh it in place
//   Sync          the library is merged with the account's copy (library.ts
//                 syncLibrary — /api/page-preset), on open, after every save /
//                 delete, and on demand; signed out it stays per browser
//   Strategy Tester / Alerts  open the two panels of their own
//                 (testerPanels.ts): a strategy() script's backtest, and the
//                 on / off switch for every script's alertcondition() / alert()
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
import { CBSCRIPT, compile, loadRuntime, onScriptError, scriptErrors } from './engine'
import { instanceIdFor, libIdOf, loadLibrary, markDeleted, newScriptId, saveLibrary, syncLibrary, TEMPLATE, type Script } from './library'
import { alertsArmed } from './alerts'
import { ThemedSelect } from '../themedSelect'
import { ALERTS_PANEL_ID, registerTesterPanels, TESTER_PANEL_ID } from './testerPanels'

const PANEL_ID = 'cbedge-scripts'
const PERSIST_KEY = 'cbedge.scripts'

const REFERENCE = `PINE SCRIPT  paste a TradingView indicator as is (v4, v5, v6)
  Runs per bar the way TradingView does: var, x[1], if / for / while /
  switch, your own functions f(x) =>, tuples [a, b] = …, ta.* math.*
  str.* color.* input.*, plot plotshape plotchar plotarrow hline fill
  bgcolor barcolor.
  request.security (higher timeframes, other symbols this app charts:
  ES, NQ, SPY, QQQ …) and request.security_lower_tf. Arrays, for…in.
  Drawings: label / line / box / linefill / polyline / table, with
  their set_* / get_* / delete and the max_*_count limits.
  User types (type / enum / method), maps, Type.new, p.x := …
  strategy(): orders are simulated — the Strategy Tester panel.
  alertcondition / alert: switch them on in the Script Alerts panel.
  Not yet: matrices, TradingView libraries (import).
  A script that stops: Copy error + script, and send it over.

CB EDGE LEVELS  one click: this week's EM, pivot and zones for the
  active chart's symbol, as a script (click again to refresh).
SYNC  signed in, your scripts follow you to every device.

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
  const pick = new ThemedSelect(doc, 'cb-scr-pick', 'Saved scripts')
  const btnNew = el(doc, 'button', 'cb-scr-btn', 'New')
  const btnDel = el(doc, 'button', 'cb-scr-btn', 'Delete')
  pickRow.append(pick.el, btnNew, btnDel)

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
  // an error can be selected, and copied in one tap — alone, or with the script for a bug report
  const copyRow = el(doc, 'div', 'cb-scr-row')
  const btnCopy = el(doc, 'button', 'cb-scr-btn cb-scr-small', 'Copy error')
  const btnCopyAll = el(doc, 'button', 'cb-scr-btn cb-scr-small', 'Copy error + script')
  copyRow.append(btnCopy, btnCopyAll)
  copyRow.hidden = true

  // ── CB Edge levels + sync ──
  const toolRow = el(doc, 'div', 'cb-scr-row')
  const btnLevels = el(doc, 'button', 'cb-scr-btn', 'CB Edge levels')
  btnLevels.title = "This week's CB Edge EM & levels for the active chart's symbol, as a script on the chart"
  const btnSync = el(doc, 'button', 'cb-scr-btn', 'Sync')
  btnSync.title = 'Merge your scripts with your account, so every device has them'
  const syncNote = el(doc, 'span', 'cb-scr-note', '')
  toolRow.append(btnLevels, btnSync, syncNote)

  // ── Strategy Tester / Alerts: panels of their own ──
  const linkRow = el(doc, 'div', 'cb-scr-row')
  const btnTester = el(doc, 'button', 'cb-scr-btn', 'Strategy Tester')
  btnTester.title = "A strategy() script's backtest — net profit, drawdown, the equity curve and every trade"
  const btnAlerts = el(doc, 'button', 'cb-scr-btn', 'Alerts')
  btnAlerts.title = "Switch scripts' alertcondition() / alert() on, and see what fired"
  linkRow.append(btnTester, btnAlerts)
  btnTester.addEventListener('click', () => ctx.togglePanel(TESTER_PANEL_ID, true))
  btnAlerts.addEventListener('click', () => ctx.togglePanel(ALERTS_PANEL_ID, true))
  const renderLinks = () => {
    btnAlerts.textContent = alertsArmed(cur.id) ? 'Alerts · on' : 'Alerts'
  }

  const ref = el(doc, 'details', 'cb-scr-ref')
  const sum = el(doc, 'summary', '', 'Reference')
  const pre = el(doc, 'pre', 'cb-scr-pre', REFERENCE)
  ref.append(sum, pre)

  body.append(pickRow, name, code, actRow, status, copyRow, toolRow, linkRow, ref)

  const say = (text: string, kind: 'ok' | 'err' | 'info' = 'info', fromChart = false) => {
    status.textContent = text
    status.dataset.kind = kind
    status.dataset.chart = fromChart ? '1' : ''
    copyRow.hidden = kind !== 'err'
  }
  const copyText = (t: string, btn: HTMLButtonElement) => {
    const label = btn.textContent
    const done = (ok: boolean) => {
      btn.textContent = ok ? 'Copied' : 'Select and copy it'
      setTimeout(() => (btn.textContent = label), 1400)
    }
    const fallback = () => {
      const ta = doc.createElement('textarea')
      ta.value = t
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      doc.body.append(ta)
      ta.select()
      let ok = false
      try {
        ok = doc.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
      done(ok)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(() => done(true), fallback)
    else fallback()
  }
  btnCopy.addEventListener('click', () => copyText(status.textContent ?? '', btnCopy))
  btnCopyAll.addEventListener('click', () => copyText(`${status.textContent ?? ''}\n\n--- script: ${name.value.trim() || 'Untitled'} ---\n${code.value}`, btnCopyAll))
  /** An error one of this script's chart copies has (data-dependent, so Save's dry run missed it). */
  const chartError = (): string | null => {
    for (const [id, msg] of scriptErrors()) if (libIdOf(id) === cur.id) return msg
    return null
  }
  const fillPick = () => {
    const known = lib.some((s) => s.id === cur.id)
    pick.setOptions(
      (known ? lib : [...lib, cur]).map((s) => ({ value: s.id, label: known || s.id !== cur.id ? s.name : `${s.name} (unsaved)` })),
      cur.id,
    )
  }
  const show = (s: Script) => {
    cur = { ...s }
    name.value = s.name
    code.value = s.source
    dirty = false
    armedDelete = false
    btnDel.textContent = 'Delete'
    fillPick()
    renderLinks()
  }
  const read = (): Script => ({ id: cur.id, name: name.value.trim() || 'Untitled', source: code.value, u: Date.now() })

  // ── Sync ──
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let lastSync = 0
  const doSync = async (manual: boolean) => {
    if (!manual && Date.now() - lastSync < 30_000) return
    lastSync = Date.now()
    syncNote.textContent = 'Syncing…'
    const r = await syncLibrary()
    if (r.status === 'signed-out') {
      syncNote.textContent = 'Sign in to sync across devices'
      return
    }
    if (r.status === 'error' || !r.scripts) {
      syncNote.textContent = `Sync failed — ${r.error ?? 'try again'}`
      return
    }
    const clock = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    syncNote.textContent = `Synced ${clock}${r.pulled ? ` · ${r.pulled} from other devices` : ''}${r.skipped?.length ? ` · too big to sync: ${r.skipped.join(', ')}` : ''}`
    lib = r.scripts
    for (const s of lib) updateRunning(ctx, s)
    if (!dirty) {
      const s = lib.find((x) => x.id === cur.id)
      show(s ?? lib[0] ?? { id: newScriptId(), name: 'My script', source: TEMPLATE })
    } else fillPick()
  }
  const scheduleSync = () => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      lastSync = 0
      void doSync(false)
    }, 1500)
  }
  btnSync.addEventListener('click', () => void doSync(true))

  // ── CB Edge levels ──
  btnLevels.addEventListener('click', async () => {
    const sym = (ctx.chart.market.symbol ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()
    if (!sym) return
    btnLevels.disabled = true
    say(`Fetching CB Edge levels for ${sym}…`, 'info')
    try {
      const r = await fetch(`/api/pinescript?ticker=${encodeURIComponent(sym)}&format=json`, { cache: 'no-store', credentials: 'same-origin' })
      if (r.status === 401 || r.status === 403) {
        say('CB Edge levels come with a subscription — sign in first', 'err')
        return
      }
      if (r.status === 404) {
        say(`No CB Edge levels are published for ${sym} this week`, 'info')
        return
      }
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const j = (await r.json()) as { pine?: unknown }
      if (typeof j.pine !== 'string' || !j.pine.trim()) throw new Error('the reply carried no script')
      const id = `cbl-${sym.toLowerCase().replace(/[^a-z0-9]/g, '')}`
      const s: Script = { id, name: `CB Edge levels — ${sym}`, source: j.pine.replace(/\r\n?/g, '\n'), u: Date.now() }
      await loadRuntime()
      compile(s.source)
      lib = lib.some((x) => x.id === id) ? lib.map((x) => (x.id === id ? s : x)) : [...lib, s]
      saveLibrary(lib)
      scheduleSync()
      show(s)
      const n = updateRunning(ctx, s)
      const here = ctx.chart.indicators().some((h) => libIdOf(h.id) === id)
      if (!here) ctx.addIndicator({ name: s.name, script: s.source, language: CBSCRIPT, id: instanceIdFor(id) })
      say(here ? `CB Edge levels for ${sym} refreshed${n > 1 ? ` on ${n} charts` : ''}` : `Added CB Edge levels for ${sym} — this week's EM, pivot and buy / sell zones`, 'ok')
    } catch (e) {
      say(`CB Edge levels: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      btnLevels.disabled = false
    }
  })

  /** Check + store. Returns the saved script, or null (and says why). */
  const save = async (): Promise<Script | null> => {
    const s = read()
    let warnings: string[] = []
    try {
      await loadRuntime()
      const { result } = compile(s.source)
      warnings = result.warnings
      const saved = lib.find((x) => x.id === s.id)
      const was = saved ? declaredTitle(saved.source) : null
      // a name that was just the old title follows the new one
      if (result.meta.title && (!name.value.trim() || name.value.trim() === 'Pasted script' || name.value.trim() === 'My script' || (was && name.value.trim() === was))) s.name = result.meta.title
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), 'err')
      return null
    }
    const i = lib.findIndex((x) => x.id === s.id)
    lib = i >= 0 ? lib.map((x, k) => (k === i ? s : x)) : [...lib, s]
    saveLibrary(lib)
    scheduleSync()
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
  btnAdd.addEventListener('click', async () => {
    const s = await save()
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
    markDeleted(cur.id)
    scheduleSync()
    show(lib[0] ?? { id: newScriptId(), name: 'My script', source: TEMPLATE })
    say('Deleted — charts running it keep their copy', 'info')
  })
  pick.onChange = (v) => {
    const s = lib.find((x) => x.id === v)
    if (s) {
      show(s)
      const e = chartError()
      if (e) say(`On the chart — ${e}`, 'err', true)
      else say('', 'info')
    }
  }
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
  void doSync(true)
  const offErrors = onScriptError((id, msg) => {
    if (libIdOf(id) !== cur.id) return
    if (msg) say(`On the chart — ${msg}`, 'err', true)
    else if (status.dataset.chart === '1') say('Running on the chart', 'ok')
  })
  return {
    onOpen() {
      // another tab or chart may have saved meanwhile
      if (!dirty) {
        lib = loadLibrary()
        const s = lib.find((x) => x.id === cur.id)
        if (s) show(s)
        else fillPick()
      }
      const e = chartError()
      if (e) say(`On the chart — ${e}`, 'err', true)
      renderLinks()
      void doSync(false)
    },
    destroy() {
      offErrors()
      pick.destroy()
      if (syncTimer) clearTimeout(syncTimer)
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
  registerTesterPanels()
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
