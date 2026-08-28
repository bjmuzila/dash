import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { useQuery } from '@/data/api'
import { watchFrame } from '@/data/hooks'
import { isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { GexData, GexFrame, GexRow, SpotFrame } from '@/contract/frames'
import { SegGroup } from '../gexCandles/controls'
import { useCanvasRenderer } from '../chart-render'
import { chainGexUrl, chainToGex, EMPTY_CHAIN_GEX } from '../chainGex'
import { drawGexChart, fmtGexShort, type GexBar, type GexChartModel, type GexOrientation } from './gexChartRender'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — net gamma by strike, live off the socket.
//
// ── Two sources, one shape ───────────────────────────────────────────────────
// SPX comes off the socket: every `gex` frame already carries both bases per
// strike plus the walls and the flip, so nothing is fetched and the basis switch
// is a redraw, not a request. Any OTHER page symbol comes from /api/chains
// through board/chainGex.ts, which produces the identical row shape — so the
// only thing that differs below is where `frameRef` is filled from.
//
// Spot follows the same split: the `spot` frame for SPX (the live print, which
// the gex frame does not carry), the chain's own underlyingPrice otherwise.
//
// ── netGEX IS NOT OI+VOL ─────────────────────────────────────────────────────
// From server-v2/computation/gex-calculator.js: `netGEX` is the OI-ONLY net and
// `netVolGEX` is the VOLUME-ONLY net, and the OI+VOL basis every other surface
// uses is the two SUMMED (`oiVolNet()`). The first cut of this card mapped
// OI+VOL straight onto `netGEX`, which drew the OI-only ladder under a label
// promising both. Fixed; the sum is what `OI+VOL` now shows.
//
// ── The socket path goes through watchFrame, not useField ────────────────────
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

/** OI+VOL is the two summed; VOL is the volume term alone. */
function valueOfRow(r: GexRow, basis: Basis): number {
  const vol = Number(r.netVolGEX) || 0
  return basis === 'vol' ? vol : (Number(r.netGEX) || 0) + vol
}

export function GexChartCard() {
  const { onMount, onResize, setDraw } = useCanvasRenderer()
  const { symbol } = usePageSymbol()
  const onSocket = isSocketSymbol(symbol)

  const [basis, setBasis] = useState<Basis>(() => (readStored(BASIS_KEY, 'oivol') === 'vol' ? 'vol' : 'oivol'))
  const [orientation, setOrientation] = useState<GexOrientation>(() =>
    readStored(ORIENT_KEY, 'horizontal') === 'vertical' ? 'vertical' : 'horizontal',
  )
  /** The one number worth a re-render: the board total, printed in the toolbar. */
  const [total, setTotal] = useState<number | null>(null)

  // The last frame, kept raw so the basis switch can re-derive the bars without
  // waiting for another frame to land.
  const frameRef = useRef<GexData | null>(null)
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
            .map<GexBar>((r) => ({ strike: r.strike, value: valueOfRow(r, b) })),
          spot: spotRef.current,
          callWall: d.callWall,
          putWall: d.putWall,
          flip: d.gexFlip,
        }
      : { ...EMPTY, spot: spotRef.current }
    setDraw((canvas, w, h) => drawGexChart(canvas, w, h, { ...model, orientation: o }))
  }, [setDraw])

  const publish = useCallback(
    (d: GexData | null) => {
      frameRef.current = d
      // The total is the only value that leaves the imperative path, and it
      // moves once per frame rather than once per tick.
      let sum: number | null = null
      if (d) {
        sum = 0
        for (const r of d.gexRows) sum += valueOfRow(r, optsRef.current.basis)
      }
      setTotal(sum)
      redraw()
    },
    [redraw],
  )

  // ── SPX: the socket ────────────────────────────────────────────────────────
  // Returning undefined when off-socket is what UNSUBSCRIBES on a symbol
  // change, which is also what narrows the socket's derived topic scope — the
  // card stops asking for `gex` the moment it stops reading it.
  useEffect(() => {
    if (!onSocket) return
    return watchFrame<GexFrame>('gex', (frame) => {
      const d = frame?.data
      if (d) publish(d)
    })
  }, [onSocket, publish])

  useEffect(() => {
    if (!onSocket) return
    return watchFrame<SpotFrame>('spot', (frame) => {
      const px = frame?.data.spot
      if (typeof px !== 'number' || !(px > 0)) return
      spotRef.current = px
      redraw()
    })
  }, [onSocket, redraw])

  // ── Everything else: the chain ─────────────────────────────────────────────
  // 15s, the same cadence Multi Greek polls its ladders on. `staleMs` alone
  // would never refetch — it is a cache TTL, not an interval — so this card
  // would sit on the ladder it loaded with.
  const chainQ = useQuery<unknown>(onSocket ? null : chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const chainGex = useMemo(() => (onSocket ? EMPTY_CHAIN_GEX : chainToGex(chainQ.data)), [onSocket, chainQ.data])

  useEffect(() => {
    if (onSocket) return
    spotRef.current = chainGex.spot || null
    publish(
      chainGex.rows.length
        ? {
            gexRows: chainGex.rows,
            callWall: chainGex.callWall,
            putWall: chainGex.putWall,
            gexFlip: chainGex.flip,
            totalNetGex: 0,
            totals: null,
            expiry: chainGex.expiry,
          }
        : null,
    )
  }, [onSocket, chainGex, publish])

  // A symbol change must not leave the previous one's ladder on screen while
  // the next source warms up — that is the failure where an AMZN heading sits
  // over SPX's strikes.
  useEffect(() => {
    frameRef.current = null
    spotRef.current = null
    setTotal(null)
    redraw()
  }, [symbol, redraw])

  // A switch changed: re-derive from the frame already in hand.
  useEffect(() => {
    const d = frameRef.current
    if (d) {
      let sum = 0
      for (const r of d.gexRows) sum += valueOfRow(r, basis)
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
        <span
          title={
            onSocket
              ? 'Live off the WebSocket — SPX is the one underlying it streams'
              : `Derived from ${symbol}'s option chain, polled every 15s. The socket only streams SPX`
          }
          className="text-[10px] uppercase tracking-[0.1em] text-muted opacity-60"
        >
          Net GEX{onSocket ? '' : ' · chain'}
        </span>
        <span
          className={[
            'tabular font-mono text-[11px] font-extrabold',
            total == null ? 'text-muted opacity-50' : total >= 0 ? 'text-gex-pos' : 'text-gex-neg',
          ].join(' ')}
        >
          {total == null ? '—' : fmtGexShort(total)}
        </span>
        <SegGroup
          title="OI+VOL is the open-interest net PLUS today's volume net — the two summed, which is the basis every other GEX surface uses. VOL is the volume term alone. Both are already in hand, so this switch redraws and does not refetch"
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
          <span className="absolute left-1 top-1 text-[10px] text-muted opacity-50">
            {onSocket ? 'Waiting for the feed…' : `Loading ${symbol}'s chain…`}
          </span>
        )}
      </div>
    </div>
  )
}
