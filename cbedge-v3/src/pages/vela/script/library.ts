// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the script library: the user's saved scripts, per browser.
//
// localStorage `cb-v3-vela-scripts` → { v: 1, scripts: [{ id, name, source }] }.
// Per browser, like every other Vela preference here: a script written on the
// laptop is not on the phone until it is saved there too (syncing it would need
// a table on the server). Seeded with three examples the first time, so the
// editor opens on something that shows the format.
//
// A script ON A CHART carries its own copy of the source in the chart's saved
// state (panel.ts persistence), keyed `cbs-<library id>-<n>`, so deleting a
// script from the library never blanks a chart; saving an edit updates every
// chart running that library script.
// ─────────────────────────────────────────────────────────────────────────────

export interface Script {
  id: string
  name: string
  source: string
}

const KEY = 'cb-v3-vela-scripts'

const EXAMPLES: Script[] = [
  {
    id: 'ex-ema',
    name: 'EMA cross',
    source: `// EMA cross — two averages, shaded between, a marker where they cross
indicator("EMA cross", overlay=true)
fastLen = input("Fast", 9, min=1)
slowLen = input("Slow", 21, min=1)
fast = ema(close, fastLen)
slow = ema(close, slowLen)
p1 = plot(fast, "Fast", color=gold, width=2)
p2 = plot(slow, "Slow", color=blue, width=2)
fill(p1, p2, color=gold, opacity=0.08)
marker(crossover(fast, slow), position="below", color=green)
marker(crossunder(fast, slow), position="above", color=red)
`,
  },
  {
    id: 'ex-rsi',
    name: 'RSI',
    source: `// RSI in its own pane, with the 70 / 30 lines and a tint when stretched
indicator("RSI", overlay=false)
len = input("Length", 14, min=2)
r = rsi(close, len)
plot(r, "RSI", color=purple, width=2)
hline(70, "Overbought", color=red)
hline(30, "Oversold", color=green)
bgcolor(r > 70, color=red, opacity=0.08)
bgcolor(r < 30, color=green, opacity=0.08)
`,
  },
  {
    id: 'ex-bands',
    name: 'Bands + VWAP',
    source: `// Bollinger bands around a 20 SMA, plus the session VWAP
indicator("Bands + VWAP", overlay=true)
len = input("Length", 20, min=2)
mult = input("Multiplier", 2, step=0.1)
up = plot(bb_upper(close, len, mult), "Upper", color=teal)
dn = plot(bb_lower(close, len, mult), "Lower", color=teal)
fill(up, dn, color=teal, opacity=0.06)
plot(sma(close, len), "Basis", color=gray, dashed=true)
plot(vwap(), "VWAP", color=orange, width=2)
`,
  },
]

/** A blank script for "New". */
export const TEMPLATE = `// My script — see Reference below for every name and function
indicator("My script", overlay=true)
len = input("Length", 20, min=1)
plot(ema(close, len), "EMA", color=gold, width=2)
`

export function loadLibrary(): Script[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) {
      saveLibrary(EXAMPLES)
      return EXAMPLES.map((s) => ({ ...s }))
    }
    const j: unknown = JSON.parse(raw)
    const list = (j as { scripts?: unknown })?.scripts
    if (!Array.isArray(list)) return []
    return list
      .filter(
        (s): s is Script =>
          !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.source === 'string',
      )
      .map((s) => ({ id: s.id, name: s.name, source: s.source }))
  } catch {
    return EXAMPLES.map((s) => ({ ...s }))
  }
}

export function saveLibrary(list: readonly Script[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, scripts: list }))
  } catch {
    /* private mode: the script still runs this visit */
  }
}

export function newScriptId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`
}

/** The library id inside a chart instance id `cbs-<lib>-<n>`, or null. */
export function libIdOf(instanceId: string): string | null {
  const m = /^cbs-(.+)-[a-z0-9]+$/.exec(instanceId)
  return m ? m[1]! : null
}

/** A fresh chart instance id for a library script. */
export function instanceIdFor(libId: string): string {
  return `cbs-${libId}-${Math.floor(Math.random() * 46656).toString(36)}`
}
