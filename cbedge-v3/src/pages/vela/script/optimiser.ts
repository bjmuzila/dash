// ─────────────────────────────────────────────────────────────────────────────
// THE STRATEGY OPTIMISER: the Strategy Tester's Optimise tab.
//
// It tries ranges of a strategy's number settings and ranks what comes out.
// Every combination runs the same backtest the chart does: the same program,
// the same bars (exactly the ones the chart has loaded), the same CB Edge walls
// and request.security series (engine.ts runContext). So a row here is what the
// chart would show with those settings.
//
//   1. Tick the settings to vary, and give each a from, a to and a step
//      (defaults: half to one and a half times the current value, five steps).
//   2. Pick what ranks the rows: net profit, profit factor, win rate, or net
//      profit per dollar of drawdown.
//   3. Run. It works through the grid in slices so the page stays responsive,
//      and Stop keeps whatever has run.
//   4. Apply puts a row's settings on the chart's strategy, and the tester
//      re-runs it.
//
// At most 400 combinations a run. Rows with fewer than 5 trades rank last:
// three lucky trades are not a better strategy.
//
// A warning, said in the panel too: the best row on past bars is fitted to those
// bars. Check it on another range before trusting it.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndicatorHandle, InputValue } from '@luxalgo/vela'
import { loadRuntime, runContext } from './engine'
import { ThemedSelect } from '../themedSelect'

const MAX_COMBOS = 400
const MIN_TRADES = 5

type Rank = 'net' | 'pf' | 'win' | 'netdd'
const RANKS: { v: Rank; label: string }[] = [
  { v: 'net', label: 'Net profit' },
  { v: 'pf', label: 'Profit factor' },
  { v: 'win', label: 'Win rate' },
  { v: 'netdd', label: 'Net ÷ max drawdown' },
]

interface Param {
  key: string
  title: string
  int: boolean
  cur: number
  min: number | null
  max: number | null
  on: boolean
  from: number
  to: number
  step: number
}

interface Row {
  values: Record<string, number>
  trades: number
  win: number
  net: number
  pf: number
  dd: number
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

const money = (v: number) => {
  const d = Math.abs(v) >= 1000 ? 0 : 2
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}
const round = (v: number, int: boolean) => (int ? Math.round(v) : Math.round(v * 100) / 100)

function paramsOf(h: IndicatorHandle): Param[] {
  const vals = h.inputValues()
  const out: Param[] = []
  for (const i of h.inputs) {
    if (i.type !== 'int' && i.type !== 'float') continue
    if (Array.isArray((i as { options?: unknown }).options)) continue
    const int = i.type === 'int'
    const curRaw = vals[i.key] ?? i.defval
    const cur = typeof curRaw === 'number' && Number.isFinite(curRaw) ? curRaw : 0
    const min = typeof (i as { min?: unknown }).min === 'number' ? ((i as { min: number }).min) : null
    const max = typeof (i as { max?: unknown }).max === 'number' ? ((i as { max: number }).max) : null
    const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
    let from = clamp(round(cur * 0.5, int))
    let to = clamp(round(cur === 0 ? 10 : cur * 1.5, int))
    if (from === to) to = clamp(round(from + (int ? 5 : 1), int))
    if (from > to) [from, to] = [to, from]
    const step = int ? Math.max(1, Math.round((to - from) / 5)) : Math.max(0.01, round((to - from) / 5, false))
    out.push({ key: i.key, title: i.title ?? i.key, int, cur, min, max, on: out.length < 2, from, to, step })
  }
  return out
}

function valuesOf(p: Param): number[] {
  if (!p.on) return [p.cur]
  const out: number[] = []
  const step = Math.abs(p.step) || (p.int ? 1 : 0.1)
  for (let v = p.from; v <= p.to + step * 1e-9 && out.length < 200; v += step) out.push(round(v, p.int))
  return out.length ? [...new Set(out)] : [p.cur]
}

function countCombos(ps: Param[]): number {
  return ps.reduce((n, p) => n * valuesOf(p).length, 1)
}

function* combos(ps: Param[]): Generator<Record<string, number>> {
  const lists = ps.map(valuesOf)
  const idx = lists.map(() => 0)
  const total = countCombos(ps)
  for (let n = 0; n < total; n++) {
    const out: Record<string, number> = {}
    ps.forEach((p, k) => (out[p.key] = lists[k]![idx[k]!]!))
    yield out
    for (let k = idx.length - 1; k >= 0; k--) {
      idx[k]!++
      if (idx[k]! < lists[k]!.length) break
      idx[k] = 0
    }
  }
}

function score(r: Row, rank: Rank): number {
  const enough = r.trades >= MIN_TRADES ? 0 : -1e15
  switch (rank) {
    case 'pf':
      return enough + (Number.isFinite(r.pf) ? r.pf : 1e6)
    case 'win':
      return enough + r.win
    case 'netdd':
      return enough + (r.dd > 0 ? r.net / r.dd : r.net > 0 ? 1e6 : r.net)
    default:
      return enough + r.net
  }
}

export interface OptimiserOpts {
  id: string
  title: string
  handle: () => IndicatorHandle | null
  toast: (msg: string, kind?: 'info' | 'success' | 'error') => void
}

export function mountOptimiser(host: HTMLElement, o: OptimiserOpts): { destroy: () => void } {
  let params: Param[] = []
  let rank: Rank = 'net'
  let rows: Row[] = []
  let running = false
  let stop = false
  let alive = true
  let done = 0
  let total = 0

  const root = el('div', 'cb-op-root')
  host.replaceChildren(root)
  const rankSel = new ThemedSelect(document, 'cb-scr-pick cb-op-rank', 'Rank by')
  rankSel.setOptions(
    RANKS.map((r) => ({ value: r.v, label: r.label })),
    rank,
  )
  rankSel.onChange = (v) => {
    rank = v as Rank
    rows.sort((a, b) => score(b, rank) - score(a, rank))
    draw()
  }

  const init = () => {
    const h = o.handle()
    params = h ? paramsOf(h) : []
  }

  function draw() {
    if (!alive) return
    root.replaceChildren()
    root.append(el('div', 'cb-scr-note', `Try ranges of “${o.title}”’s settings on the chart’s bars and rank the results.`))
    if (!params.length) {
      root.append(el('div', 'cb-st-tip', 'This strategy has no number settings to vary (input.int / input.float).'))
      return
    }
    const table = el('div', 'cb-op-params')
    const head = el('div', 'cb-op-prow cb-op-phead')
    head.append(el('span', '', ''), el('span', '', 'Setting'), el('span', '', 'From'), el('span', '', 'To'), el('span', '', 'Step'))
    table.append(head)
    for (const p of params) {
      const row = el('div', 'cb-op-prow')
      const on = el('input', '')
      on.type = 'checkbox'
      on.checked = p.on
      on.disabled = running
      on.addEventListener('change', () => {
        p.on = on.checked
        draw()
      })
      const name = el('span', 'cb-op-name', p.title)
      name.title = `Now ${p.cur}`
      const num = (field: 'from' | 'to' | 'step') => {
        const i = el('input', 'cb-scr-name cb-op-num')
        i.type = 'number'
        i.step = p.int ? '1' : 'any'
        i.value = String(p[field])
        i.disabled = running || !p.on
        i.addEventListener('change', () => {
          const v = Number(i.value)
          if (Number.isFinite(v)) p[field] = field === 'step' ? Math.abs(v) || (p.int ? 1 : 0.1) : round(v, p.int)
          draw()
        })
        return i
      }
      row.append(on, name, num('from'), num('to'), num('step'))
      table.append(row)
    }
    root.append(table)

    const n = countCombos(params)
    const ctl = el('div', 'cb-scr-row cb-op-ctl')
    const count = el('span', 'cb-scr-note', n > MAX_COMBOS ? `${n} combinations: over ${MAX_COMBOS}, narrow a range or widen a step` : `${n} combination${n === 1 ? '' : 's'}`)
    const go = el('button', `cb-scr-btn ${running ? '' : 'cb-scr-primary'}`, running ? 'Stop' : 'Run')
    go.type = 'button'
    go.disabled = !running && (n > MAX_COMBOS || n < 1)
    go.addEventListener('click', () => (running ? (stop = true) : void run()))
    ctl.append(el('span', 'cb-scr-note', 'Rank by'), rankSel.el, count, go)
    root.append(ctl)
    if (running) root.append(el('div', 'cb-op-progress', `Running ${done} / ${total}…`))

    if (rows.length) {
      const res = el('div', 'cb-op-results')
      const th = el('div', 'cb-op-rrow cb-op-rhead')
      const keys = params.filter((p) => p.on).map((p) => p.key)
      th.append(el('span', '', keys.map((k) => params.find((p) => p.key === k)!.title).join(' · ')), el('span', '', 'Trades'), el('span', '', 'Win'), el('span', '', 'Net'), el('span', '', 'PF'), el('span', '', 'Max DD'), el('span', '', ''))
      res.append(th)
      for (const r of rows.slice(0, 25)) {
        const tr = el('div', 'cb-op-rrow')
        if (r.trades < MIN_TRADES) tr.dataset.few = 'true'
        const apply = el('button', 'cb-scr-btn cb-scr-small', 'Apply')
        apply.type = 'button'
        apply.title = 'Put these settings on the chart’s strategy'
        apply.addEventListener('click', () => {
          const h = o.handle()
          if (!h) return o.toast('The strategy is no longer on the chart', 'error')
          h.setInputs(r.values as Record<string, InputValue>)
          o.toast(`Applied ${keys.map((k) => `${params.find((p) => p.key === k)!.title} ${r.values[k]}`).join(', ')}`, 'success')
        })
        const net = el('span', 'cb-op-net', money(r.net))
        net.dataset.tone = r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''
        tr.append(
          el('span', 'cb-op-vals', keys.map((k) => String(r.values[k])).join(' · ')),
          el('span', '', String(r.trades)),
          el('span', '', `${Math.round(r.win)}%`),
          net,
          el('span', '', Number.isFinite(r.pf) ? r.pf.toFixed(2) : '∞'),
          el('span', '', money(-r.dd)),
          apply,
        )
        res.append(tr)
      }
      root.append(res)
      root.append(el('div', 'cb-st-tip', 'The best row is fitted to these bars. Check it on another range (or symbol) before trusting it. Rows under 5 trades are greyed and ranked last.'))
    }
  }

  async function run() {
    const ctx = runContext(o.id)
    if (!ctx) {
      o.toast('Let the backtest run once on the chart first', 'info')
      return
    }
    const rt = await loadRuntime()
    running = true
    stop = false
    rows = []
    done = 0
    total = countCombos(params)
    draw()
    const it = combos(params)
    const step = () => {
      if (!alive) return
      const t0 = performance.now()
      while (performance.now() - t0 < 24) {
        const nx = it.next()
        if (nx.done || stop) {
          running = false
          rows.sort((a, b) => score(b, rank) - score(a, rank))
          draw()
          if (!stop) o.toast(`Optimiser: ${done} runs done`, 'success')
          return
        }
        try {
          const res = rt.run(ctx.prog, ctx.bars, { ...ctx.opts, inputs: { ...ctx.inputs, ...nx.value } })
          const st = res.strategy
          if (st) {
            const trades = st.closed.length
            rows.push({
              values: nx.value,
              trades,
              win: trades ? (st.wins / trades) * 100 : 0,
              net: st.netProfit,
              pf: st.grossLoss !== 0 ? st.grossProfit / Math.abs(st.grossLoss) : st.grossProfit > 0 ? Infinity : 0,
              dd: st.maxDrawdown,
            })
          }
        } catch {
          /* a combination the script rejects (a length of 0, say): skipped */
        }
        done++
      }
      draw()
      setTimeout(step, 0)
    }
    setTimeout(step, 0)
  }

  init()
  draw()
  return {
    destroy: () => {
      alive = false
      stop = true
      rankSel.destroy()
    },
  }
}
