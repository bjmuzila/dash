// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the engine: Vela's ScriptingEngine port, implemented.
//
// Vela ships no scripting engine; it runs scripts through whatever is
// registered under a language id (the workspace's `engines` option, see
// pages/Vela.tsx). This is ours, language 'cbscript':
//
//   prepare(source)    parse (lang.ts) + one run over zero bars (runtime.ts) — a
//                      typo or an unknown function fails HERE, before anything
//                      lands on a chart — and hand back the inputs schema
//                      (Vela builds the settings dialog from it) and the
//                      indicator() title / overlay
//   execute(req, h)    run over the chart's bars, build an IndicatorModel, give
//                      it to `h.onModel`; the session re-runs on new bars
//                      (throttled to ~6 a second) and on input changes
//
// Plots become line-like series, hline() price lines, fill() fills between two
// plots, bgcolor() backgrounds — every id minted with Vela's stableSeriesId, so
// a re-run patches values instead of rebuilding. marker() becomes LABELS (the
// model's Pine label.new channel, anchored abovebar / belowbar on the price
// pane): Vela's renderer has no painter for a `markers` series kind, it would
// be accepted and never drawn.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Background,
  DrawingLabel,
  ExecutionHandlers,
  ExecutionRequest,
  ExecutionSession,
  Fill,
  IndicatorModel,
  InputSchema,
  InputValue,
  OHLCV,
  PreparedScript,
  PriceLine,
  ScriptingEngine,
  SeriesSpec,
} from '@luxalgo/vela'
import { stableSeriesId } from '@luxalgo/vela/plugin'
import { parse, type Stmt } from './lang'
import { run, type RunResult } from './runtime'

export const CBSCRIPT = 'cbscript'

interface Token {
  prog: Stmt[]
  id: string
}

/** Parse + check a script without a chart. Throws a ScriptError (with its line) on any fault. */
export function compile(source: string): { prog: Stmt[]; result: RunResult } {
  const prog = parse(source)
  return { prog, result: run(prog, []) }
}

function valuesOf(schema: readonly InputSchema[], given: Record<string, InputValue> | undefined): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const s of schema) out[s.key] = given?.[s.key] ?? s.defval
  return out
}

export function toModel(id: string, res: RunResult, bars: readonly OHLCV[], inputValues: Record<string, InputValue>): IndicatorModel {
  const series: SeriesSpec[] = res.plots.map((p, ordinal) => ({
    id: stableSeriesId({ instanceId: id, kind: p.style, title: p.title, ordinal }),
    title: p.title,
    paneId: '',
    kind: p.style,
    points: bars.map((b, i) => {
      const v = p.values[i]
      const value = v == null || Number.isNaN(v) ? null : v
      const color = p.colors?.[i]
      return color ? { time: b.time, value, color } : { time: b.time, value }
    }),
    style: { color: p.color, width: p.width, lineStyle: p.dashed ? ('dashed' as const) : ('solid' as const) },
  }))
  const plotIds = series.map((s) => s.id)
  const labels: DrawingLabel[] = res.markers
    .filter((m) => bars[m.i])
    .map((m, k) => ({
      id: `${id}-mk${k}`,
      paneId: '',
      xloc: 'bar_time' as const,
      x: bars[m.i]!.time,
      y: m.position === 'aboveBar' ? bars[m.i]!.high : bars[m.i]!.low,
      yloc: m.position === 'aboveBar' ? ('abovebar' as const) : ('belowbar' as const),
      ...(m.text ? { text: m.text } : {}),
      style: m.shape,
      color: m.color,
      textColor: m.color,
      size: m.size,
      textAlign: 'center' as const,
      fontFamily: 'default' as const,
      // above / below a BAR means the price pane, whichever pane the plots are in
      overlay: true,
    }))
  const fills: Fill[] = res.fills
    .filter((f) => plotIds[f.a] && plotIds[f.b])
    .map((f, k) => ({
      id: stableSeriesId({ instanceId: id, kind: 'fill', title: `fill ${k}`, ordinal: k }),
      paneId: '',
      fromSeriesId: plotIds[f.a]!,
      toSeriesId: plotIds[f.b]!,
      color: f.color,
    }))
  const priceLines: PriceLine[] = res.hlines.map((h, k) => ({
    id: stableSeriesId({ instanceId: id, kind: 'hline', title: h.title || `hline ${k}`, ordinal: k }),
    paneId: '',
    price: h.price,
    color: h.color,
    lineStyle: h.style,
    width: h.width,
    ...(h.title ? { title: h.title } : {}),
  }))
  const backgrounds: Background[] = res.backgrounds
    .filter((b) => bars[b.from] && bars[b.to])
    .map((b, k) => ({
      id: stableSeriesId({ instanceId: id, kind: 'background', title: `bg ${k}`, ordinal: k }),
      paneId: '',
      from: bars[b.from]!.time,
      to: bars[b.to]!.time,
      color: b.color,
    }))
  return {
    id,
    title: res.meta.title,
    ...(res.meta.shorttitle ? { shorttitle: res.meta.shorttitle } : {}),
    overlay: res.meta.overlay,
    paneHint: res.meta.overlay ? 'price' : 'new',
    series,
    fills,
    backgrounds,
    priceLines,
    ...(labels.length ? { labels } : {}),
    inputs: res.inputs,
    inputValues,
  }
}

/** Live re-runs coalesce to at most one per this many ms. */
const THROTTLE_MS = 160

export class CbScriptEngine implements ScriptingEngine {
  readonly language = CBSCRIPT
  readonly capabilities = { streaming: true, visibleRange: false, inputs: true }

  async prepare(source: string, instanceId: string): Promise<PreparedScript> {
    const { prog, result } = compile(source)
    const token: Token = { prog, id: instanceId }
    return {
      language: CBSCRIPT,
      inputs: result.inputs,
      meta: {
        title: result.meta.title,
        overlay: result.meta.overlay,
        ...(result.meta.shorttitle ? { shorttitle: result.meta.shorttitle } : {}),
        ...(result.meta.precision != null ? { precision: result.meta.precision } : {}),
      },
      reactsToViewport: false,
      token,
    }
  }

  execute(req: ExecutionRequest, h: ExecutionHandlers): ExecutionSession {
    const token = req.prepared.token as Token
    let inputs: Record<string, InputValue> = { ...(req.inputs ?? {}) }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = 0
    let first = true
    const compute = () => {
      timer = null
      if (stopped) return
      last = Date.now()
      const bars = req.getBars?.() ?? req.bars
      try {
        const res = run(token.prog, bars, { inputs })
        h.onModel(toModel(token.id, res, bars, valuesOf(res.inputs, inputs)))
        if (first) {
          first = false
          h.onDone?.()
        }
      } catch (e) {
        h.onError?.(e instanceof Error ? e : new Error(String(e)))
      }
    }
    queueMicrotask(compute)
    return {
      stop() {
        stopped = true
        if (timer) clearTimeout(timer)
        timer = null
      },
      update(next: Record<string, InputValue>) {
        inputs = { ...next }
        if (timer) clearTimeout(timer)
        compute()
      },
      setVisibleRange() {},
      notifyBars() {
        if (stopped || timer) return
        timer = setTimeout(compute, Math.max(0, THROTTLE_MS - (Date.now() - last)))
      },
    }
  }
}
