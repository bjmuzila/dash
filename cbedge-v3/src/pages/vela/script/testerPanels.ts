// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the Strategy Tester and Alerts panels. Two Vela SIDE PANELS of
// their own (a topbar button each, beside Scripts; rows in ⋮ on a phone), so a
// backtest or the alert switches stay open next to the chart while the editor
// is closed. The Scripts panel links to both.
//
//   Strategy Tester   every strategy() script running on a chart (newest run
//                     first, a picker when there are several):
//                       Overview  net profit, drawdown, win rate, profit factor,
//                                 average trade, open P/L; long vs short; the
//                                 equity curve over the drawdown
//                       Trades    every closed trade, newest first, with its
//                                 entry / exit and running P/L
//                     Live: it redraws as the chart's bars land
//                     (engine.ts onScriptResult).
//   Alerts            every saved script that calls alertcondition() / alert(),
//                     each with its on / off switch (alerts.ts — off until
//                     switched on, per script), what it declares and where it
//                     runs; desktop notifications; and what fired, newest
//                     first, across all scripts.
// ─────────────────────────────────────────────────────────────────────────────

import { registerSidePanel, type WidgetContext } from '@luxalgo/vela'
import type { WorkspaceWidgetContext } from '@luxalgo/vela/workspace'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { CBSCRIPT, compile, loadRuntime, onScriptError, onScriptResult, scriptErrors, scriptResults, type ScriptRunInfo } from './engine'
import { instanceIdFor, libIdOf, loadLibrary, newScriptId, requestEdit, saveLibrary, type Script } from './library'
import { IS_STRATEGY, READY_STRATEGIES, USES_CBEDGE, readyStrategy } from './strategies'
import { ThemedSelect, type SelectOption } from '../themedSelect'
import { alertsArmed, enableNotify, firedAlerts, notifyWanted, onScriptAlertFired, setAlertsArmed, tfLabel } from './alerts'

export const TESTER_PANEL_ID = 'cbedge-strategy'
export const ALERTS_PANEL_ID = 'cbedge-script-alerts'
const SCRIPTS_PANEL_ID = 'cbedge-scripts'
const TAB_KEY = 'cb-v3-vela-st-tab'

type Strat = NonNullable<ScriptRunInfo['strategy']>
type Tone = 'up' | 'down' | ''

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}
const toneOf = (v: number): Tone => (v > 0 ? 'up' : v < 0 ? 'down' : '')
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })}`
const signed = (v: number) => (v > 0 ? `+${money(v)}` : money(v))
const pct = (v: number) => (Number.isFinite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : '—')
const price = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 2 : 4 }) : '—')
const TIME = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'America/New_York' })
const CLOCK = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })

/** An empty state with a way to the Scripts panel. */
function emptyState(doc: Document, ctx: WidgetContext, text: string): HTMLElement {
  const box = el(doc, 'div', 'cb-st-empty')
  box.append(el(doc, 'div', '', text))
  const open = el(doc, 'button', 'cb-scr-btn', 'Open Scripts')
  open.type = 'button'
  open.addEventListener('click', () => ctx.togglePanel(SCRIPTS_PANEL_ID, true))
  box.append(open)
  return box
}

// ═════════════════════════════════════════════════════════════════════════════
// Strategy Tester
// ═════════════════════════════════════════════════════════════════════════════

/** Every chart the context can see (a workspace lists them all). */
function chartsOf(ctx: WidgetContext) {
  const cells = (ctx as Partial<WorkspaceWidgetContext>).cells
  return cells ? cells.map((c) => c.chart) : [ctx.chart]
}

/** A strategy script on a chart (with or without a result yet). */
interface OnChart {
  id: string
  title: string
  source: string
  visible: boolean
  info: (ScriptRunInfo & { strategy: Strat }) | null
  error: string | null
}

/** Put a strategy on the ACTIVE chart (through the shell: undo, the legend, the saved layout). */
export function addStrategy(ctx: WidgetContext, s: { id: string; name: string; source: string }): void {
  ctx.addIndicator({ name: s.name, script: s.source, language: CBSCRIPT, id: instanceIdFor(s.id) })
}

/** A strategy picked elsewhere (the Indicators dialog): the tester shows it once it runs. */
let focusReq: { libId: string; name: string; at: number } | null = null
/** Put a strategy on the active chart (unless it is there) and open the tester on it. */
export function testStrategy(ctx: WidgetContext, s: { id: string; name: string; source: string }): void {
  if (!ctx.chart.indicators().some((h) => libIdOf(h.id) === s.id)) addStrategy(ctx, s)
  focusReq = { libId: s.id, name: s.name, at: Date.now() }
  ctx.togglePanel(TESTER_PANEL_ID, true)
}

function mountTester(ctx: WidgetContext, body: HTMLElement) {
  const doc = body.ownerDocument
  body.classList.add('cb-scr', 'cb-st')
  for (const t of ['keydown', 'keyup', 'keypress'] as const) body.addEventListener(t, (e) => e.stopPropagation())

  // ── the picker: what is on the chart, the ready-made ones, yours, paste ──
  const pick = new ThemedSelect(doc, 'cb-scr-pick cb-st-pick', 'Strategy')
  pick.placeholder = 'Choose a strategy to test…'
  const pickRow = el(doc, 'div', 'cb-scr-row')
  pickRow.append(pick.el)

  // ── paste a TradingView strategy ──
  const pasteBox = el(doc, 'div', 'cb-st-paste')
  pasteBox.hidden = true
  const pasteArea = el(doc, 'textarea', 'cb-scr-code cb-st-pastecode')
  pasteArea.placeholder = 'Paste a TradingView strategy here — it must start with strategy(…)'
  pasteArea.spellcheck = false
  const pasteRow = el(doc, 'div', 'cb-scr-row')
  const pasteRun = el(doc, 'button', 'cb-scr-btn cb-scr-primary', 'Run on chart')
  pasteRun.type = 'button'
  const pasteCancel = el(doc, 'button', 'cb-scr-btn', 'Cancel')
  pasteCancel.type = 'button'
  pasteRow.append(pasteRun, pasteCancel)
  const pasteMsg = el(doc, 'div', 'cb-st-err')
  pasteBox.append(el(doc, 'div', 'cb-st-h', 'Paste a strategy'), pasteArea, pasteRow, pasteMsg)

  // ── the strategy being shown ──
  const bar = el(doc, 'div', 'cb-st-bar')
  const tabs = el(doc, 'div', 'cb-st-tabs')
  tabs.setAttribute('role', 'tablist')
  const tabBtn = (id: 'overview' | 'trades', label: string) => {
    const b = el(doc, 'button', 'cb-st-tab', label)
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.dataset.tab = id
    b.addEventListener('click', () => {
      tab = id
      try {
        localStorage.setItem(TAB_KEY, id)
      } catch {
        /* private mode */
      }
      render()
    })
    return b
  }
  tabs.append(tabBtn('overview', 'Overview'), tabBtn('trades', 'List of trades'))
  const view = el(doc, 'div', 'cb-st-view')
  body.append(pickRow, pasteBox, bar, tabs, view)

  let selected: string | null = null
  /** A library / ready-made id just added: selected as soon as its first run lands. */
  let pending: { libId: string; name: string; at: number } | null = null
  let tab: 'overview' | 'trades' = 'overview'
  try {
    if (localStorage.getItem(TAB_KEY) === 'trades') tab = 'trades'
  } catch {
    /* private mode */
  }

  const onChart = (): OnChart[] => {
    const results = scriptResults()
    const lib = loadLibrary()
    const out: OnChart[] = []
    for (const chart of chartsOf(ctx))
      for (const h of chart.indicators()) {
        if (!h.source || !IS_STRATEGY.test(h.source)) continue
        const r = results.get(h.id)
        const libId = libIdOf(h.id) ?? ''
        // the strategy's own title once it has run; until then the name it was added under
        const title = r?.title || readyStrategy(libId)?.name || lib.find((x) => x.id === libId)?.name || h.title
        out.push({
          id: h.id,
          title,
          source: h.source,
          visible: h.visible,
          info: r?.strategy ? (r as ScriptRunInfo & { strategy: Strat }) : null,
          error: scriptErrors().get(h.id) ?? null,
        })
      }
    return out
  }
  const savedStrategies = () => loadLibrary().filter((s) => IS_STRATEGY.test(s.source) && !readyStrategy(s.id))

  function choose(libId: string, name: string, source: string) {
    // already on the active chart: just show it
    const here = ctx.chart.indicators().find((h) => libIdOf(h.id) === libId)
    if (here) {
      selected = here.id
      pending = null
      render()
      return
    }
    addStrategy(ctx, { id: libId, name, source })
    pending = { libId, name, at: Date.now() }
    selected = null
    render()
  }

  pick.onChange = (v) => {
    if (v === 'paste') {
      pasteBox.hidden = false
      pasteMsg.textContent = ''
      pasteArea.focus()
      return
    }
    const [kind, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)]
    if (kind === 'run') {
      selected = id
      pending = null
      render()
    } else if (kind === 'ready') {
      const r = readyStrategy(id)
      if (r) choose(r.id, r.name, r.source)
    } else if (kind === 'lib') {
      const s = loadLibrary().find((x) => x.id === id)
      if (s) choose(s.id, s.name, s.source)
    }
  }

  pasteCancel.addEventListener('click', () => {
    pasteBox.hidden = true
    pasteArea.value = ''
  })
  pasteRun.addEventListener('click', async () => {
    const source = pasteArea.value.replace(/\r\n?/g, '\n')
    if (!source.trim()) return pasteArea.focus()
    if (!IS_STRATEGY.test(source)) {
      pasteMsg.textContent = 'That is an indicator(…) script — it has no trades to test. The tester needs a script that starts with strategy(…).'
      return
    }
    pasteRun.disabled = true
    try {
      await loadRuntime()
      const { result } = compile(source)
      const s: Script = { id: newScriptId(), name: result.meta.title || 'Pasted strategy', source, u: Date.now() }
      saveLibrary([...loadLibrary(), s])
      pasteBox.hidden = true
      pasteArea.value = ''
      choose(s.id, s.name, s.source)
      ctx.toast(`“${s.name}” saved to your scripts and added to the chart`, 'success')
    } catch (e) {
      pasteMsg.textContent = e instanceof Error ? e.message : String(e)
    } finally {
      pasteRun.disabled = false
    }
  })

  function fillPicker(list: OnChart[]) {
    const opts: SelectOption[] = []
    const seen = new Map<string, number>()
    for (const c of list) {
      const base = c.title
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      const where = c.info ? `${c.info.symbol} ${tfLabel(c.info.timeframe)}` : c.error ? 'error' : c.visible ? 'running' : 'hidden'
      opts.push({ value: `run:${c.id}`, label: n > 1 ? `${base} (${n})` : base, hint: where, group: 'On the chart' })
    }
    for (const r of READY_STRATEGIES) opts.push({ value: `ready:${r.id}`, label: r.name, hint: 'add', group: 'Ready-made' })
    for (const s of savedStrategies()) opts.push({ value: `lib:${s.id}`, label: s.name, hint: 'add', group: 'Your scripts' })
    opts.push({ value: 'paste', label: '+ Paste a TradingView strategy…', action: true })
    pick.setOptions(opts, selected ? `run:${selected}` : '')
  }

  function render() {
    if (focusReq) {
      pending = focusReq
      focusReq = null
    }
    const list = onChart()
    // a strategy just added: pick it once it is on the chart
    if (pending) {
      const got = list.find((c) => libIdOf(c.id) === pending!.libId)
      if (got) {
        selected = got.id
        if (got.info || got.error) pending = null
      } else if (Date.now() - pending.at > 15_000) pending = null
    }
    if (selected && !list.some((c) => c.id === selected)) selected = null
    if (!selected && !pending && list.length) selected = (list.find((c) => c.info) ?? list[0]!).id
    fillPicker(list)
    const cur = list.find((c) => c.id === selected) ?? null

    if (!cur) {
      bar.hidden = true
      tabs.hidden = true
      view.replaceChildren(...(pending ? [el(doc, 'div', 'cb-st-wait', `Adding “${pending.name}” to the chart and running the backtest…`)] : intro()))
      return
    }
    // the bar: where it runs, edit, remove
    bar.hidden = false
    const where = cur.info ? `${cur.info.symbol} · ${tfLabel(cur.info.timeframe)} · ${cur.info.bars.toLocaleString('en-US')} bars` : cur.error ? 'stopped on an error' : cur.visible ? 'running…' : 'hidden on the chart'
    const edit = el(doc, 'button', 'cb-scr-btn cb-scr-small', 'Edit')
    edit.type = 'button'
    edit.title = 'Open it in Scripts'
    edit.addEventListener('click', () => editStrategy(cur))
    const remove = el(doc, 'button', 'cb-scr-btn cb-scr-small', 'Remove')
    remove.type = 'button'
    remove.title = 'Take it off the chart'
    remove.addEventListener('click', () => {
      for (const chart of chartsOf(ctx)) chart.indicators().find((h) => h.id === cur.id)?.remove()
      ctx.stateChanged()
      selected = null
      setTimeout(render, 80)
    })
    bar.replaceChildren(el(doc, 'span', 'cb-scr-note', where), edit, remove)

    if (!cur.info) {
      tabs.hidden = true
      view.replaceChildren(
        cur.error
          ? el(doc, 'div', 'cb-st-err', cur.error)
          : el(doc, 'div', 'cb-scr-note', cur.visible ? 'Running the backtest…' : 'It is hidden on the chart — show it (the eye in its legend row) to run the backtest.'),
      )
      return
    }
    tabs.hidden = false
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('.cb-st-tab')) b.setAttribute('aria-selected', String(b.dataset.tab === tab))
    const st = cur.info.strategy
    const notes: HTMLElement[] = []
    if (USES_CBEDGE.test(cur.source) && !st.closed.length && !st.open.length)
      notes.push(
        el(
          doc,
          'div',
          'cb-st-tip',
          `No trades on these bars: this strategy waits for price to tag CB Edge’s put or call wall. Try a longer range, a wider touch distance (its settings), or a symbol the walls recorder covers (SPX, NDX, ES, NQ and the GEX names).`,
        ),
      )
    if (cur.info.bars < 1500)
      notes.push(el(doc, 'div', 'cb-st-tip', `Tested on the ${cur.info.bars.toLocaleString('en-US')} bars the chart has loaded. For a longer test pick a longer range under the chart (1M, 3M) or zoom out — the backtest re-runs on its own.`))
    view.replaceChildren(...notes, ...(tab === 'overview' ? overview(cur.info, st) : trades(st)))
  }

  /** The empty tester: how it works, and the four ready-made strategies one click away. */
  function intro(): HTMLElement[] {
    const out: HTMLElement[] = []
    const how = el(doc, 'div', 'cb-st-how')
    how.append(
      el(doc, 'b', '', 'Backtest a strategy on this chart'),
      el(doc, 'div', 'cb-scr-note', 'Pick one below (or from the menu above) and it goes on the chart and runs straight away: every trade is drawn on the candles, and the results — net profit, drawdown, win rate, the equity curve and the trade list — show here.'),
    )
    out.push(how)
    out.push(el(doc, 'div', 'cb-st-h', 'Ready-made'))
    for (const r of READY_STRATEGIES) out.push(strategyCard(r.name, r.desc, () => choose(r.id, r.name, r.source)))
    const mine = savedStrategies()
    if (mine.length) {
      out.push(el(doc, 'div', 'cb-st-h', 'Your scripts'))
      for (const s of mine) out.push(strategyCard(s.name, 'Saved in Scripts', () => choose(s.id, s.name, s.source)))
    }
    const paste = el(doc, 'button', 'cb-scr-btn', '+ Paste a TradingView strategy')
    paste.type = 'button'
    paste.addEventListener('click', () => {
      pasteBox.hidden = false
      pasteArea.focus()
    })
    out.push(el(doc, 'div', 'cb-st-h', 'Your own'), paste)
    return out
  }
  function strategyCard(name: string, desc: string, add: () => void): HTMLElement {
    const c = el(doc, 'div', 'cb-st-pickcard')
    const t = el(doc, 'div', 'cb-st-pickt')
    t.append(el(doc, 'b', '', name), el(doc, 'div', 'cb-scr-note', desc))
    const b = el(doc, 'button', 'cb-scr-btn cb-scr-primary cb-scr-small', 'Add to chart')
    b.type = 'button'
    b.addEventListener('click', add)
    c.append(t, b)
    return c
  }

  /** Open the strategy in Scripts: your own script as it is; a ready-made one as a copy you own. */
  function editStrategy(cur: OnChart) {
    const lib = loadLibrary()
    const libId = libIdOf(cur.id)
    let target = lib.find((s) => s.id === libId)
    let note: string | undefined
    if (!target) {
      target = { id: newScriptId(), name: `${cur.title} (my copy)`, source: cur.source, u: Date.now() }
      saveLibrary([...lib, target])
      note = 'This is your copy of the ready-made strategy — Save, then Add to chart to test your version.'
    }
    requestEdit(target.id, note)
    ctx.togglePanel(SCRIPTS_PANEL_ID, true)
  }

  function overview(info: ScriptRunInfo, st: Strat): HTMLElement[] {
    const closed = st.closed.length
    const pf = st.grossLoss > 0 ? st.grossProfit / st.grossLoss : st.grossProfit > 0 ? Infinity : NaN
    const winsP = st.closed.filter((t) => t.profit > 0)
    const lossP = st.closed.filter((t) => t.profit < 0)
    const avgWin = winsP.length ? winsP.reduce((s, t) => s + t.profit, 0) / winsP.length : 0
    const avgLoss = lossP.length ? lossP.reduce((s, t) => s + t.profit, 0) / lossP.length : 0
    const head = el(
      doc,
      'div',
      'cb-scr-note',
      `${info.symbol} · ${tfLabel(info.timeframe)} · ${info.bars.toLocaleString('en-US')} bars · capital ${money(st.initialCapital)} · ${st.fills} fills`,
    )
    const cards = el(doc, 'div', 'cb-st-cards')
    const card = (label: string, value: string, sub: string, tone: Tone = '') => {
      const c = el(doc, 'div', 'cb-st-card')
      c.append(el(doc, 'div', 'cb-st-label', label))
      const v = el(doc, 'div', 'cb-st-value', value)
      if (tone) v.dataset.tone = tone
      c.append(v, el(doc, 'div', 'cb-st-sub', sub))
      cards.append(c)
    }
    card('Net profit', signed(st.netProfit), pct((st.netProfit / st.initialCapital) * 100), toneOf(st.netProfit))
    card('Max drawdown', money(st.maxDrawdown), pct(st.maxDrawdownPct), st.maxDrawdown > 0 ? 'down' : '')
    card('Win rate', closed ? pct((st.wins / closed) * 100) : '—', `${st.wins} of ${closed} trades`)
    card('Profit factor', Number.isFinite(pf) ? pf.toFixed(2) : pf === Infinity ? '∞' : '—', `+${money(st.grossProfit)} / −${money(st.grossLoss)}`)
    card('Avg trade', closed ? signed(st.netProfit / closed) : '—', closed ? `win ${money(avgWin)} · loss ${money(avgLoss)}` : 'no closed trades', closed ? toneOf(st.netProfit) : '')
    card('Open P/L', signed(st.openProfit), st.open.length ? `${st.open.length} open` : 'flat', toneOf(st.openProfit))

    // long vs short
    const sides = el(doc, 'div', 'cb-st-sides')
    sides.append(...['', 'Trades', 'Win rate', 'Net'].map((h) => el(doc, 'span', 'cb-st-th', h)))
    for (const [label, dir] of [
      ['Long', 1],
      ['Short', -1],
    ] as const) {
      const ts = st.closed.filter((t) => t.dir === dir)
      const net = ts.reduce((s, t) => s + t.profit, 0)
      const w = ts.filter((t) => t.profit > 0).length
      sides.append(el(doc, 'span', 'cb-st-td', label), el(doc, 'span', 'cb-st-td', String(ts.length)), el(doc, 'span', 'cb-st-td', ts.length ? pct((w / ts.length) * 100) : '—'))
      const n = el(doc, 'span', 'cb-st-td', ts.length ? signed(net) : '—')
      if (ts.length) n.dataset.tone = toneOf(net)
      sides.append(n)
    }

    const charts = equityCharts(st)
    const foot = el(
      doc,
      'div',
      'cb-scr-note',
      'Simulated on the chart’s bars: market orders fill at the next bar’s open; limit and stop orders where the bar’s path (open → nearer extreme → the other → close) reaches them. Commission per the script’s strategy() settings.',
    )
    return [head, cards, el(doc, 'div', 'cb-st-h', 'Equity'), ...charts, el(doc, 'div', 'cb-st-h', 'Long vs short'), sides, foot]
  }

  /** The equity line (area over the starting capital) and, under it, the drawdown. */
  function equityCharts(st: Strat): HTMLElement[] {
    const NS = 'http://www.w3.org/2000/svg'
    const eq = st.equity
    const wrap = el(doc, 'div', 'cb-st-chart')
    if (eq.length < 2) {
      wrap.append(el(doc, 'div', 'cb-scr-note', 'Not enough bars for a curve yet.'))
      return [wrap]
    }
    const W = 300
    const H = 110
    const DH = 34
    const lo = Math.min(...eq, st.initialCapital)
    const hi = Math.max(...eq, st.initialCapital)
    const span = hi - lo || 1
    const x = (k: number) => ((k / (eq.length - 1)) * W).toFixed(1)
    const y = (v: number) => (H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)
    const svg = doc.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'cb-st-eq')
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    const up = st.netProfit + st.openProfit >= 0
    const line = eq.map((v, k) => `${x(k)},${y(v)}`).join(' ')
    const y0 = y(st.initialCapital)
    const area = doc.createElementNS(NS, 'polygon')
    area.setAttribute('points', `0,${y0} ${line} ${W},${y0}`)
    area.setAttribute('class', up ? 'cb-st-area-up' : 'cb-st-area-down')
    const base = doc.createElementNS(NS, 'line')
    base.setAttribute('x1', '0')
    base.setAttribute('x2', String(W))
    base.setAttribute('y1', y0)
    base.setAttribute('y2', y0)
    base.setAttribute('class', 'cb-st-base')
    const poly = doc.createElementNS(NS, 'polyline')
    poly.setAttribute('points', line)
    poly.setAttribute('class', up ? 'cb-st-line-up' : 'cb-st-line-down')
    svg.append(area, base, poly)
    // drawdown: how far under its running high the equity sits
    let peak = -Infinity
    const dd = eq.map((v) => {
      peak = Math.max(peak, v)
      return v - peak
    })
    const worst = Math.min(...dd) || -1
    const dsvg = doc.createElementNS(NS, 'svg')
    dsvg.setAttribute('class', 'cb-st-dd')
    dsvg.setAttribute('viewBox', `0 0 ${W} ${DH}`)
    dsvg.setAttribute('preserveAspectRatio', 'none')
    const dpoly = doc.createElementNS(NS, 'polygon')
    dpoly.setAttribute('points', `0,0 ${dd.map((v, k) => `${x(k)},${((v / worst) * (DH - 2)).toFixed(1)}`).join(' ')} ${W},0`)
    dsvg.append(dpoly)
    const axis = el(doc, 'div', 'cb-st-axis')
    axis.append(el(doc, 'span', '', DATE.format(st.times[0] ?? 0)), el(doc, 'span', '', `drawdown ${money(Math.abs(Math.min(...dd)))}`), el(doc, 'span', '', DATE.format(st.times[st.times.length - 1] ?? 0)))
    wrap.append(svg, dsvg, axis)
    return [wrap]
  }

  function trades(st: Strat): HTMLElement[] {
    const MAX = 300
    if (!st.closed.length) return [el(doc, 'div', 'cb-scr-note', st.open.length ? `No closed trades yet · ${st.open.length} open (${signed(st.openProfit)}).` : 'No trades on these bars yet.')]
    const cum: number[] = []
    let run = 0
    for (const t of st.closed) cum.push((run += t.profit))
    const grid = el(doc, 'div', 'cb-st-trades')
    grid.append(...['#', 'Trade', 'Entry', 'Exit', 'P/L', 'Cum.'].map((h) => el(doc, 'span', 'cb-st-th', h)))
    const n = st.closed.length
    for (let k = n - 1; k >= Math.max(0, n - MAX); k--) {
      const t = st.closed[k]!
      const side = el(doc, 'span', 'cb-st-td')
      side.append(el(doc, 'b', t.dir > 0 ? 'cb-st-long' : 'cb-st-short', t.dir > 0 ? 'Long' : 'Short'), doc.createTextNode(` ${t.qty}`))
      // the order's id, when it says more than the side does
      if (t.entryId && !/^(long|short|buy|sell)$/i.test(t.entryId)) side.append(el(doc, 'div', 'cb-st-mini', t.entryId))
      const cell = (when: number, px: number) => {
        const c = el(doc, 'span', 'cb-st-td')
        c.append(el(doc, 'div', '', TIME.format(when)), el(doc, 'div', 'cb-st-mini', price(px)))
        return c
      }
      const pl = el(doc, 'span', 'cb-st-td', signed(t.profit))
      pl.dataset.tone = toneOf(t.profit)
      const cu = el(doc, 'span', 'cb-st-td', signed(cum[k]!))
      cu.dataset.tone = toneOf(cum[k]!)
      grid.append(el(doc, 'span', 'cb-st-td cb-st-mini', String(k + 1)), side, cell(t.entryTime, t.entryPrice), cell(t.exitTime, t.exitPrice), pl, cu)
    }
    const out: HTMLElement[] = [grid]
    if (n > MAX) out.push(el(doc, 'div', 'cb-scr-note', `The newest ${MAX} of ${n} trades.`))
    if (st.open.length) out.unshift(el(doc, 'div', 'cb-scr-note', `${st.open.length} open · ${signed(st.openProfit)} unrealised`))
    return out
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const later = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      render()
    }, 400)
  }
  const off = onScriptResult((info) => {
    if (info.strategy || pending) later()
  })
  const offErr = onScriptError(() => later())
  // a strategy added or removed on the chart shows up here without a run of its own
  let lastIds = ''
  const poll = setInterval(() => {
    if (!body.offsetParent) return
    const ids = onChart()
      .map((c) => c.id)
      .join(',')
    if (ids !== lastIds || pending) {
      lastIds = ids
      render()
    }
  }, 1500)
  render()
  return {
    onOpen: render,
    destroy() {
      off()
      offErr()
      clearInterval(poll)
      pick.destroy()
      if (timer) clearTimeout(timer)
    },
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Alerts
// ═════════════════════════════════════════════════════════════════════════════

const CALLS_ALERT = /\balert(?:condition)?\s*\(/

function mountAlerts(ctx: WidgetContext, body: HTMLElement) {
  const doc = body.ownerDocument
  body.classList.add('cb-scr', 'cb-sa')
  const notifyLabel = el(doc, 'label', 'cb-scr-check')
  const notify = el(doc, 'input', '')
  notify.type = 'checkbox'
  notifyLabel.append(notify, doc.createTextNode(' Desktop notifications too'))
  const intro = el(doc, 'div', 'cb-scr-note', 'A script’s alerts do nothing until switched on here. Fired alerts land in the toolbar Alerts feed and as a toast; on new bars only, never the history a chart loads with.')
  const list = el(doc, 'div', 'cb-sa-list')
  const logHead = el(doc, 'div', 'cb-st-h', 'Fired')
  const log = el(doc, 'div', 'cb-sa-log')
  body.append(intro, notifyLabel, el(doc, 'div', 'cb-st-h', 'Scripts'), list, logHead, log)

  /** Condition titles off a script's source, once the language chunk is here (cached by source). */
  const declaredMemo = new Map<string, string[]>()
  let runtimeReady = false
  const declared = (src: string): string[] => {
    if (!runtimeReady) return []
    let t = declaredMemo.get(src)
    if (!t) {
      try {
        t = compile(src).result.alerts.conditions.map((c) => c.title)
      } catch {
        t = []
      }
      declaredMemo.set(src, t)
    }
    return t
  }

  function render() {
    notify.checked = notifyWanted() && typeof Notification !== 'undefined' && Notification.permission === 'granted'
    const scripts = loadLibrary().filter((s) => CALLS_ALERT.test(s.source))
    const runsOf = new Map<string, ScriptRunInfo[]>()
    for (const info of scriptResults().values()) {
      const id = libIdOf(info.instanceId)
      if (!id) continue
      runsOf.set(id, [...(runsOf.get(id) ?? []), info])
    }
    if (!scripts.length) {
      list.replaceChildren(emptyState(doc, ctx, 'None of your saved scripts calls alertcondition() or alert(). Save one in Scripts and it is listed here to switch on.'))
    } else {
      list.replaceChildren(
        ...scripts.map((s) => {
          const on = alertsArmed(s.id)
          const row = el(doc, 'div', 'cb-sa-row')
          if (on) row.dataset.on = '1'
          const text = el(doc, 'div', 'cb-sa-text')
          text.append(el(doc, 'div', 'cb-sa-name', s.name))
          const runs = runsOf.get(s.id) ?? []
          const latest = runs.slice().sort((a, b) => b.at - a.at)[0]
          const titles = latest?.alerts.length ? latest.alerts.map((a) => a.title) : declared(s.source)
          const usesAlert = latest?.usesAlert ?? /\balert\s*\(/.test(s.source)
          const what = [titles.length ? titles.join(' · ') : '', usesAlert ? 'alert() calls' : ''].filter(Boolean).join(' · ')
          text.append(el(doc, 'div', 'cb-scr-note', what || 'alert conditions'))
          text.append(el(doc, 'div', 'cb-scr-note', runs.length ? `On ${[...new Set(runs.map((r) => `${r.symbol} ${tfLabel(r.timeframe)}`))].join(', ')}` : 'Not on a chart — add it from Scripts to be alerted'))
          const sw = el(doc, 'button', 'cb-sa-switch')
          sw.type = 'button'
          sw.setAttribute('role', 'switch')
          sw.setAttribute('aria-checked', String(on))
          sw.setAttribute('aria-label', `Alerts for ${s.name}`)
          sw.textContent = on ? 'On' : 'Off'
          sw.addEventListener('click', () => {
            setAlertsArmed(s.id, !alertsArmed(s.id))
            render()
          })
          row.append(text, sw)
          return row
        }),
      )
    }
    const fired = firedAlerts().slice(0, 50)
    log.replaceChildren(
      ...(fired.length
        ? fired.map((a) => {
            const r = el(doc, 'div', 'cb-sa-fired')
            const top = el(doc, 'div', 'cb-sa-top')
            top.append(el(doc, 'span', 'cb-sa-time', CLOCK.format(a.at)), el(doc, 'b', '', `${a.symbol} · ${a.title}`))
            r.append(top)
            if (a.text) r.append(el(doc, 'div', '', a.text))
            r.append(el(doc, 'div', 'cb-scr-note', `${a.script} · ${tfLabel(a.timeframe)}`))
            return r
          })
        : [el(doc, 'div', 'cb-scr-note', 'Nothing has fired yet this session.')]),
    )
  }

  notify.addEventListener('change', () => {
    void enableNotify(notify.checked).then((on) => {
      if (notify.checked && !on) ctx.toast('The browser has notifications blocked for this site — alerts still land in the toolbar feed', 'info')
      render()
    })
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  const later = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      render()
    }, 800)
  }
  const offResult = onScriptResult(later)
  const offFired = onScriptAlertFired(() => render())
  render()
  void loadRuntime().then(() => {
    runtimeReady = true
    render()
  })
  return {
    onOpen: render,
    destroy() {
      offResult()
      offFired()
      if (timer) clearTimeout(timer)
    },
  }
}

let registered = false

/** Both panels and their icons. Once; before any workspace is built (registerScripts calls it). */
export function registerTesterPanels(): void {
  if (registered) return
  registered = true
  // a rising line with an arrow — a backtest
  registerIcon('cb-strategy', svg16('<path d="M2 13.5h12M2.5 11l3.5-3.5 2.5 2L13 5"/><path d="M10 5h3v3"/>'))
  // a bolt — a script's trigger (the bell beside it is Vela's own price alerts)
  registerIcon('cb-zap', svg16('<path d="M9.2 1.5 3.5 9h4.3l-1 5.5L12.5 7H8.2l1-5.5Z"/>'))
  registerSidePanel({
    id: TESTER_PANEL_ID,
    title: 'Strategy Tester',
    icon: 'cb-strategy',
    order: 101,
    width: 440,
    resizable: true,
    minWidth: 320,
    maxWidth: 820,
    mount: (ctx, body, header) => {
      header.setTitle('Strategy Tester')
      return mountTester(ctx, body)
    },
  })
  registerSidePanel({
    id: ALERTS_PANEL_ID,
    title: 'Script Alerts',
    icon: 'cb-zap',
    order: 102,
    width: 360,
    resizable: true,
    minWidth: 300,
    maxWidth: 640,
    mount: (ctx, body, header) => {
      header.setTitle('Script Alerts')
      return mountAlerts(ctx, body)
    },
  })
}
