// ─────────────────────────────────────────────────────────────────────────────
// COPY INDICATORS TO ALL CHARTS — one tap, every chart in the layout gets the
// studies the chart you are on carries, settings included.
//
// Vela keeps an indicator ledger PER CHART and has no "apply to all": its Style
// sync copies colours and chart type, never studies. So this is a contributed
// widget action:
//   · desktop  an icon button in the topbar's right cluster (beside the camera)
//   · phone    ⋮ → "Copy indicators to all charts"
//
// ── What "copy" means ────────────────────────────────────────────────────────
// ADDITIVE. Every study on the active chart lands on every other chart in the
// layout, with the active chart's inputs and visibility; nothing a chart already
// has is taken off:
//   · a built-in (native) study the other chart already has (same type) takes the
//     active chart's settings — CB Walls on 20 sessions makes every chart's CB
//     Walls 20 sessions — and one it lacks is added
//   · a script study (RSI, EMA …) is added unless that chart already has one
//     with identical settings, so pressing twice never doubles anything, and an
//     EMA 20 beside an EMA 50 copies as both
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
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import type { CellState, VelaWorkspace } from '@luxalgo/vela/workspace'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'

type Ledger = NonNullable<CellState['indicators']>
type NativeEntry = Ledger['natives'][number]

const nativeType = (e: NativeEntry) => (typeof e === 'string' ? e : e.type)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** `source`'s studies merged into `target`'s ledger — additive, as described above. */
export function mergeLedger(target: Ledger, source: Ledger): Ledger {
  const natives = target.natives.slice()
  const taken = new Set<number>()
  for (const s of source.natives) {
    const t = nativeType(s)
    const i = natives.findIndex((e, k) => !taken.has(k) && nativeType(e) === t)
    if (i >= 0) {
      natives[i] = s
      taken.add(i)
    } else {
      natives.push(s)
      taken.add(natives.length - 1)
    }
  }
  const manifest = target.manifest.slice()
  const matched = new Set<number>()
  for (const s of source.manifest) {
    const i = manifest.findIndex((e, k) => !matched.has(k) && same(e, s))
    if (i >= 0) matched.add(i)
    else {
      manifest.push(s)
      matched.add(manifest.length - 1)
    }
  }
  return { natives, manifest }
}

/** The workspace the page has mounted (one at a time — /vela and /m/vela never coexist). */
let current: VelaWorkspace | null = null

export function bindIndicatorsWorkspace(ws: VelaWorkspace): () => void {
  current = ws
  return () => {
    if (current === ws) current = null
  }
}

function copyToAll(ctx: WidgetContext): void {
  const ws = current
  if (!ws) return
  const cells = ws.cells()
  const source = ws.active
  if (cells.length < 2) {
    ctx.toast('Only one chart in this layout', 'info')
    return
  }
  const from = source.dehydrate().indicators
  if (!from || (!from.natives.length && !from.manifest.length)) {
    ctx.toast('This chart has no indicators to copy', 'info')
    return
  }
  let changed = 0
  for (const cell of cells) {
    if (cell === source) continue
    const cur = cell.dehydrate()
    const had = cur.indicators ?? { natives: [], manifest: [] }
    const next = mergeLedger(had, from)
    // field by field: a saved ledger's key order is not ours
    if (same(next.natives, had.natives) && same(next.manifest, had.manifest)) continue
    cell.rehydrate({
      indicators: next,
      // a partial state would otherwise reset these two (see the header)
      ...(cur.session ? { session: cur.session } : {}),
      ...(cur.ext ? { ext: cur.ext } : {}),
    })
    changed++
  }
  ctx.stateChanged()
  ctx.toast(
    changed ? `Indicators copied to ${changed} chart${changed === 1 ? '' : 's'}` : 'Every chart already has these indicators',
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
