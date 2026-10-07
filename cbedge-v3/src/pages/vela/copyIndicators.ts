// ─────────────────────────────────────────────────────────────────────────────
// COPY INDICATORS TO ALL CHARTS — one tap, every chart in the layout gets the
// studies the chart you are on carries, settings included.
//
// Vela keeps an indicator ledger PER CHART and has no "apply to all": its Style
// sync copies colours and chart type, never studies. So this is a contributed
// widget action:
//   · desktop  Workspace ▾ → Layout → Copy indicators to all charts (workspaceMenu.ts;
//              the action is still registered, but the desktop bar no longer lists it)
//   · phone    ⋮ → "Copy indicators to all charts"
//
// ── What "copy" means ────────────────────────────────────────────────────────
// AN EXACT COPY (Brandon, 2026-10-07: "copy all indicators with only 1 in the top
// left should make them all just have that 1"). Every other chart in the layout
// ends up with exactly the active chart's studies, inputs and visibility, and
// nothing else: a study the active chart does not carry is taken off the others.
// (It was additive until then, so a chart kept whatever it had before — the CVD
// and Net Premium panes stayed on every chart after copying a one-study chart.)
//   · built-in (native) studies and script studies (RSI, EMA …): the other
//     chart's ledger becomes the active chart's
//   · CB Scripts (pages/vela/script/ — ids `cbs-…`): one the active chart runs
//     (same saved script, same inputs) is kept or added; any other is removed
//   · pressing twice changes nothing the second time
//
// ── How ──────────────────────────────────────────────────────────────────────
// Through each cell's own state seam: `dehydrate()` gives the active chart's
// ledger (types / names plus their input deltas and hidden flags — exactly what
// the saved document records), it is merged into each other chart's ledger, and
// `rehydrate({ indicators })` converges that chart onto it in place — the chart,
// its data and its other studies' handles survive. The call carries the target's
// own session and `ext` bag so neither is reset by the partial state. Not on the
// undo timeline (a ledger convergence is state application in Vela's terms);
// the legend ✕ takes off anything copied.
//
// CB Scripts are not in that ledger (Vela leaves a plugin's scripts to the
// plugin — they ride the cell's `ext` bag, script/panel.ts), so each one goes on
// through the cell's own seam, `addExternalIndicator`, AFTER the ledger lands,
// under a fresh `cbs-<library id>-<n>` id so an edit saved in the Scripts panel
// reaches the copies too.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import type { CellState, VelaWorkspace } from '@luxalgo/vela/workspace'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { CBSCRIPT } from './script/engine'
import { instanceIdFor, libIdOf } from './script/library'

type Ledger = NonNullable<CellState['indicators']>
type NativeEntry = Ledger['natives'][number]

const nativeType = (e: NativeEntry) => (typeof e === 'string' ? e : e.type)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The ledger every other chart takes: the source's, exactly (see the header). */
export function copyLedger(source: Ledger): Ledger {
  return { natives: source.natives.slice(), manifest: source.manifest.slice() }
}

/** Natives with the same types in the same order, settings and all. */
const sameNatives = (a: Ledger['natives'], b: Ledger['natives']) =>
  a.length === b.length && a.every((e, i) => nativeType(e) === nativeType(b[i]!) && same(e, b[i]))

/** The workspace the page has mounted (one at a time — /vela and /m/vela never coexist). */
let current: VelaWorkspace | null = null

export function bindIndicatorsWorkspace(ws: VelaWorkspace): () => void {
  current = ws
  return () => {
    if (current === ws) current = null
  }
}

type Cell = ReturnType<VelaWorkspace['cells']>[number]

/** The CB Script instances on a chart: what to copy, and what a target already runs. */
function scriptsOn(cell: Cell) {
  return cell.chart
    .indicators()
    .filter((h) => !!h.source && libIdOf(h.id) != null)
    .map((h) => ({ lib: libIdOf(h.id)!, name: h.title, source: h.source!, inputs: h.inputValues(), hidden: !h.visible }))
}

/**
 * Make `cell`'s CB Scripts the source chart's: keep the ones it already runs the
 * same way, add the missing ones, take off the rest. Returns how many changed.
 */
function copyScripts(cell: Cell, from: ReturnType<typeof scriptsOn>): number {
  const handles = cell.chart.indicators().filter((h) => !!h.source && libIdOf(h.id) != null)
  const have = handles.map((h) => ({ h, lib: libIdOf(h.id)!, inputs: h.inputValues() }))
  let n = 0
  const add: ReturnType<typeof scriptsOn> = []
  for (const s of from) {
    const i = have.findIndex((x) => x.lib === s.lib && same(x.inputs, s.inputs))
    if (i >= 0) have.splice(i, 1)
    else add.push(s)
  }
  // what is left is not on the source chart
  for (const x of have) {
    x.h.remove()
    n++
  }
  for (const s of add) {
    cell.addExternalIndicator({
      name: s.name,
      script: s.source,
      language: CBSCRIPT,
      id: instanceIdFor(s.lib),
      inputs: s.inputs,
      ...(s.hidden ? { hidden: true } : {}),
    })
    n++
  }
  return n
}

/**
 * Belt and braces for the exact copy: any built-in study still on `cell` beyond
 * the source's count of that type is taken off (should the ledger convergence
 * leave one behind). Returns how many went.
 */
function dropExtraNatives(cell: Cell, from: Ledger): number {
  const left = new Map<string, number>()
  for (const e of from.natives) left.set(nativeType(e), (left.get(nativeType(e)) ?? 0) + 1)
  let n = 0
  for (const h of cell.chart.indicators()) {
    const t = h.nativeType
    if (!t) continue
    const k = left.get(t) ?? 0
    if (k > 0) left.set(t, k - 1)
    else {
      h.remove()
      n++
    }
  }
  return n
}

export function copyToAll(ctx: WidgetContext): void {
  const ws = current
  if (!ws) return
  const cells = ws.cells()
  const source = ws.active
  if (cells.length < 2) {
    ctx.toast('Only one chart in this layout', 'info')
    return
  }
  const from = source.dehydrate().indicators ?? { natives: [], manifest: [] }
  const scripts = scriptsOn(source)
  let changed = 0
  for (const cell of cells) {
    if (cell === source) continue
    const cur = cell.dehydrate()
    const had = cur.indicators ?? { natives: [], manifest: [] }
    const next = copyLedger(from)
    let moved = false
    if (!sameNatives(next.natives, had.natives) || !same(next.manifest, had.manifest)) {
      cell.rehydrate({
        indicators: next,
        // a partial state would otherwise reset these two (see the header)
        ...(cur.session ? { session: cur.session } : {}),
        ...(cur.ext ? { ext: cur.ext } : {}),
      })
      moved = true
    }
    if (dropExtraNatives(cell, from)) moved = true
    if (copyScripts(cell, scripts)) moved = true
    if (moved) changed++
  }
  ctx.stateChanged()
  ctx.toast(
    changed ? `${changed} chart${changed === 1 ? '' : 's'} now match${changed === 1 ? 'es' : ''} this one` : 'Every chart already has exactly these indicators',
    changed ? 'success' : 'info',
  )
}

let registered = false

/** Register the action (and its icon). Once; before any workspace is built. */
export function registerCopyIndicators(): void {
  if (registered) return
  registered = true
  // Two stacked panels with a study line on the front one — "this, onto the others".
  registerIcon(
    'cb-copy-ind',
    svg16(
      '<rect x="1.5" y="4.5" width="9.5" height="9.5" rx="1.5"/><path d="M5 1.5h8a1.5 1.5 0 0 1 1.5 1.5v8"/><path d="M3.5 11l2-2.6 1.6 1.4 2.2-3.1"/>',
    ),
  )
  registerWidgetAction({
    id: 'cbedge-copy-indicators',
    target: 'topbar',
    label: 'Copy indicators to all charts',
    icon: 'cb-copy-ind',
    iconOnly: true,
    mobile: 'menu',
    run: copyToAll,
  })
}
