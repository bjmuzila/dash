// ─────────────────────────────────────────────────────────────────────────────
// LAST PRICE IN ONE COLOUR (2026-10-06, Brandon: "the last price label should stay
// one color. That color can be chosen in the settings menu").
//
// Vela paints the last-price label (and its dotted line, and the countdown chip)
// in the colour of the newest candle: green on an up bar, red on a down bar, so
// the tag flickers between the two on every tick. Here it holds ONE colour, picked
// in Chart settings → Symbol → "Last price":
//
//   Last price
//     One color      ✓          (on by default; off = Vela's up/down colouring)
//     Label color    ■ swatch   (Vela's own themed picker; default Voltick Blue)
//
// Remembered per browser under `cb-v3-vela-last-price`, shared by every chart on
// /vela and /m (the phone's ⋮ → Chart settings opens the same dialog).
//
// ── How (a Vela 0.8 seam) ────────────────────────────────────────────────────
// Vela has no option for this colour: each chart's chrome painter (the
// NativeRenderer's `chrome`, a class Vela does not export) asks one method,
// `priceElementColor`, for the colour of the line, the label and the countdown
// together. That method is wrapped on the painter's prototype, reached through the
// first chart, and answers the chosen colour while "One color" is on, else falls
// through to Vela. The settings rows ride on `setSettingsSections`, which
// each chart cell calls with its own tabs (status line, timezone, …): the wrapper
// appends this section to whatever the cell passes, so nothing of Vela's is lost.
// If a Vela upgrade renames either method, the wrap is skipped (Vela's own colours
// come back, nothing breaks) and a console warning says so.
// ─────────────────────────────────────────────────────────────────────────────

import { NativeRenderer } from '@luxalgo/vela'
import { tokenHex } from '@/design/theme'

const STORE_KEY = 'cb-v3-vela-last-price'
const SECTION_ID = 'cb-last-price'

interface Pref {
  /** One colour for the label (true) or Vela's up/down colour (false). */
  fixed: boolean
  /** Any CSS colour the picker returns; empty = the default token. */
  color: string
}

function readPref(): Pref {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<Pref>
      return { fixed: r.fixed !== false, color: typeof r.color === 'string' ? r.color : '' }
    }
  } catch {
    /* private mode / bad JSON: the defaults */
  }
  return { fixed: true, color: '' }
}

let pref = readPref()

function writePref(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(pref))
  } catch {
    /* private mode: the choice lasts this visit */
  }
}

/** The label colour in force: the user's pick, else Voltick Blue. */
export function lastPriceColor(): string {
  return pref.color || tokenHex('--color-vt-accent')
}

// Charts that have shown up so far, to repaint on a change (weakly held: a closed
// chart is not kept alive by this list).
const charts = new Set<WeakRef<object>>()

function repaintAll(): void {
  for (const ref of charts) {
    const r = ref.deref() as { scheduler?: { invalidate?: (level: number) => void } } | undefined
    if (!r) {
      charts.delete(ref)
      continue
    }
    // 4 = Vela's full repaint level
    r.scheduler?.invalidate?.(4)
  }
}

// (the Symbol tab titles a section with its `title`, so no heading row)
type HostRow =
  | { kind: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void; id?: string }
  | { kind: 'color'; label: string; get: () => string; set: (v: string) => void; id?: string }

const SECTION: { title: string; id: string; placement: 'symbol'; rows: readonly HostRow[] } = {
  title: 'Last price',
  id: SECTION_ID,
  placement: 'symbol',
  rows: [
    {
      kind: 'toggle',
      label: 'One color',
      id: 'fixed',
      get: () => pref.fixed,
      set: (v) => {
        pref = { ...pref, fixed: v }
        writePref()
        repaintAll()
      },
    },
    {
      kind: 'color',
      label: 'Label color',
      id: 'color',
      get: () => lastPriceColor(),
      set: (v) => {
        pref = { ...pref, color: v, fixed: true }
        writePref()
        repaintAll()
      },
    },
  ],
}

let installed = false
let colorPatched = false

/** Wrap Vela's chrome painter's colour question — once, on the first chart seen. */
function patchColor(renderer: object): void {
  if (colorPatched) return
  const chrome = (renderer as { chrome?: object }).chrome
  const proto = chrome ? (Object.getPrototypeOf(chrome) as Record<string, unknown>) : null
  const orig = proto?.priceElementColor
  if (!proto || typeof orig !== 'function') {
    colorPatched = true
    console.warn('[vela] last-price colour: this Vela has no chrome.priceElementColor — left to Vela')
    return
  }
  colorPatched = true
  proto.priceElementColor = function (this: object, ...args: unknown[]) {
    return pref.fixed ? lastPriceColor() : (orig as (...a: unknown[]) => string).apply(this, args)
  }
}

/** Wrap Vela's renderer once, before any workspace is built. */
export function registerLastPriceColor(): void {
  if (installed) return
  installed = true
  const proto = (NativeRenderer as unknown as { prototype: Record<string, unknown> }).prototype
  const origSections = proto.setSettingsSections
  if (typeof origSections !== 'function') {
    console.warn('[vela] last-price colour: this Vela has no setSettingsSections — left to Vela')
    return
  }
  proto.setSettingsSections = function (this: object, sections: unknown) {
    charts.add(new WeakRef(this))
    patchColor(this)
    repaintAll()
    const list = Array.isArray(sections) ? sections.filter((s: { id?: string }) => s?.id !== SECTION_ID) : []
    return (origSections as (s: unknown) => unknown).call(this, [...list, SECTION])
  }
}
