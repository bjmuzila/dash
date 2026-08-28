import { useCallback, useEffect, useRef, useState } from 'react'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { watchFrame } from '@/data/hooks'
import type { GexFrame, SpotFrame } from '@/contract/frames'
import { SegGroup } from '../gexCandles/controls'
import { useCanvasRenderer } from '../chart-render'
import { drawGexChart, fmtGexShort, type GexBar, type GexChartModel, type GexOrientation } from './gexChartRender'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — net gamma by strike, live off the socket.
//
// ── No fetch at all ──────────────────────────────────────────────────────────
// Everything on this card is already on the `gex` frame: one row per strike with
// BOTH bases on it (`netGEX` = OI + today's volume, `netVolGEX` = volume only),
// plus the call wall, the put wall and the gamma flip. So the basis switch is a
// toggle over data that has already arrived, not a second request — flipping it
// redraws a canvas and touches no network.
//
// Spot comes from the `spot` frame, which is the live print; the gex frame does
// not carry one.
//
// ── Both frames go through watchFrame, not useField ──────────────────────────
// AGENTS.md rule 4. A frame lands, the model goes into a ref and the canvas is
// redrawn — this component does not re-render for a tick. Only the two toolbar
// switches are React state, because those are the only things a user changes.
// ─────────────────────────────────────────────────────────────────────────────

type Basis = 'oivol' | 'vol'

const BASIS_KEY = 'cb-v3-gex-chart-basis'
const ORIENT_KEY = 'cb-v3-gex-chart-orient'

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* best-effort — the in-memory setting still drives this session */
  }
}

const EMPTY: GexChartModel = { bars: [], spot: null, callWall: null, putWall: null, flip: null }

export function GexChartCard() {
  const { onMount, onResize, setDraw } = useCanvasRenderer()

  const [basis, setBasis] = useState<Basis>(() => (readStored(BASIS_KEY, 'oivol') === 'vol' ? 'vol' : 'oivol'))
  const [orientation, setOrientation] = useState<GexOrientation>(() =>
    readStored(ORIENT_KEY, 'horizontal') === 'vertical' ? 'vertical' : 'horizontal',
  )
  /** The one number worth a re-render: the board total, printed in the toolbar. */
  const [total, setTotal] = useState<number | null>(null)

  // The last frame, kept raw so the basis switch can re-derive the bars without
  // waiting for another frame to land.
  const frameRef = useRef<GexFrame['data'] | null>(null)
  const spotRef = useRef<number | null>(null)
  const optsRef = useRef({ basis, orientation })
  optsRef.current = { basis, orientation }

  const redraw = useCallback(() => {
    const d = frameRef.current
    const { basis: b, orientation: o } = optsRef.current
    const model: GexChartModel = d
      ? {
          bars: [...d.gexRows]
            .sort((x, y) => x.strike - y.strike)
            .map<GexBar>((r) => ({ strike: r.strike, value: b === 'vol' ? r.netVolGEX : r.netGEX })),
          spot: spotRef.current,
          callWall: d.callWall,
          putWall: d.putWall,
          flip: d.gexFlip,
        }
      : { ...EMPTY, spot: spotRef.current }
    setDraw((canvas, w, h) => drawGexChart(canvas, w, h, { ...model, orientation: o }))
  }, [setDraw])

  useEffect(
    () =>
      watchFrame<GexFrame>('gex', (frame) => {
        const d = frame?.data
        if (!d) return
        frameRef.current = d
        // The total is the only value that leaves the imperative path, and it
        // moves once per frame rather than once per tick.
        const b = optsRef.current.basis
        let sum = 0
        for (const r of d.gexRows) sum += b === 'vol' ? r.netVolGEX : r.netGEX
        setTotal(sum)
        redraw()
      }),
    [redraw],
  )

  useEffect(
    () =>
      watchFrame<SpotFrame>('spot', (frame) => {
        const px = frame?.data.spot
        if (typeof px !== 'number' || !(px > 0)) return
        spotRef.current = px
        redraw()
      }),
    [redraw],
  )

  // A switch changed: re-derive from the frame already in hand.
  useEffect(() => {
    const d = frameRef.current
    if (d) {
      let sum = 0
      for (const r of d.gexRows) sum += basis === 'vol' ? r.netVolGEX : r.netGEX
      setTotal(sum)
    }
    redraw()
  }, [basis, orientation, redraw])

  const commitBasis = (b: Basis) => {
    setBasis(b)
    write(BASIS_KEY, b)
  }
  const commitOrientation = (o: GexOrientation) => {
    setOrientation(o)
    write(ORIENT_KEY, o)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardToolbar>
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted opacity-60">Net GEX</span>
        <span
          className={[
            'tabular font-mono text-[11px] font-extrabold',
            total == null ? 'text-muted opacity-50' : total >= 0 ? 'text-gex-pos' : 'text-gex-neg',
          ].join(' ')}
        >
          {total == null ? '—' : fmtGexShort(total)}
        </span>
        <SegGroup
          title="OI+VOL is open interest plus today's volume; VOL drops the open-interest term. Both are already on every frame — this switch redraws, it does not refetch"
          options={[
            { label: 'OI+VOL', value: 'oivol' },
            { label: 'VOL', value: 'vol' },
          ]}
          value={basis}
          onChange={(v) => commitBasis(v as Basis)}
        />
        <SegGroup
          title="Which way the bars run. HORIZ puts strikes down the left edge and grows the bars sideways — the ladder you read against a price axis. VERT puts strikes along the bottom and grows them up and down — a gamma profile across the strike range"
          options={[
            { label: 'HORIZ', value: 'horizontal' },
            { label: 'VERT', value: 'vertical' },
          ]}
          value={orientation}
          onChange={(v) => commitOrientation(v as GexOrientation)}
        />
      </CardToolbar>

      <div className="relative min-h-0 flex-1">
        <ChartFrame onMount={onMount} onResize={onResize} className="absolute inset-0" />
        {total == null && (
          <span className="absolute left-1 top-1 text-[10px] text-muted opacity-50">Waiting for the chain…</span>
        )}
      </div>
    </div>
  )
}
