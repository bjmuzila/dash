import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { useQuery } from '@/data/api'
import { watchFrame } from '@/data/hooks'
import { isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { GexData, GexFrame, SpotFrame } from '@/contract/frames'
import { chainGexUrl, chainToGex, EMPTY_CHAIN_GEX } from '../chainGex'
import {
  EMPTY_MODEL,
  fmtGexShort,
  mountGexChart,
  netOf,
  type GexChartHandle,
  type GexChartModel,
} from './gexChartRender'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — v2's home-page chart, as a board card.
//
// NO TOGGLES. v2's chart has none either: `mode`, `dataMode`, `showOI`,
// `showDex` and the rest are PROPS the home page passes from its own cog, and
// the home page passes net GEX on the OI+VOL basis. That is what this draws, so
// there is nothing left for a toolbar to switch. The header carries the board
// total and, off-socket, where the numbers came from.
//
// The chart itself — pan, zoom, y-scale, recentre, the bar gradients — is
// gexChartRender.ts, which owns its canvas and its listeners. A pan is sixty
// pointer events a second; none of them reach React.
//
// ── Two sources, one shape ───────────────────────────────────────────────────
// SPX comes off the socket. Any other page symbol comes from /api/chains
// through board/chainGex.ts, which produces the identical row shape. Spot
// follows the same split: the `spot` frame for SPX (the live print, which the
// gex frame does not carry), the chain's own underlyingPrice otherwise.
// ─────────────────────────────────────────────────────────────────────────────

export function GexChartCard() {
  const { symbol } = usePageSymbol()
  const onSocket = isSocketSymbol(symbol)

  /** The one number worth a re-render: the board total, printed in the header. */
  const [total, setTotal] = useState<number | null>(null)

  const handleRef = useRef<GexChartHandle | null>(null)
  const modelRef = useRef<GexChartModel>(EMPTY_MODEL)

  // ── Offscreen cards do not paint ────────────────────────────────────────────
  // `spot` is a 10Hz topic and every tick re-pushes the ladder, so an unguarded
  // copy of this card repaints its canvas ten times a second for as long as it
  // is on the board — including while it is scrolled a thousand pixels below
  // the fold. The model is kept up to date either way (it is a ref assignment);
  // only the PAINT is deferred, and only the last one is owed, because setModel
  // redraws the whole chart from the current model.
  const visibleRef = useRef(true)
  const missedRef = useRef(false)

  const paint = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    if (!visibleRef.current) {
      missedRef.current = true
      return
    }
    missedRef.current = false
    handle.setModel(modelRef.current)
  }, [])

  const push = useCallback(
    (rows: GexData['gexRows'] | null, spot: number, sym: string) => {
      const model: GexChartModel = rows?.length ? { rows, spot, symbol: sym } : { ...EMPTY_MODEL, symbol: sym }
      modelRef.current = model
      paint()
      let sum: number | null = null
      if (rows?.length) {
        sum = 0
        for (const r of rows) sum += netOf(r)
      }
      // Left ungated on purpose: it is the header number, it must be right the
      // instant the card is scrolled back into view, and React bails out on an
      // unchanged value anyway.
      setTotal(sum)
    },
    [paint],
  )

  const onMount = useCallback(
    (frame: ChartHandle): (() => void) => {
      const created = mountGexChart(frame.el)
      handleRef.current = created
      visibleRef.current = frame.visible()
      // Replay whatever arrived before the frame mounted, so the first paint is
      // never an empty chart that fills in a beat later.
      created.setModel(modelRef.current)
      return () => {
        created.destroy()
        handleRef.current = null
      }
    },
    [],
  )

  const onResize = useCallback(() => {
    if (!visibleRef.current) {
      missedRef.current = true
      return
    }
    handleRef.current?.redraw()
  }, [])

  const onVisibility = useCallback(
    (visible: boolean) => {
      visibleRef.current = visible
      if (visible && missedRef.current) paint()
    },
    [paint],
  )

  // ── SPX: the socket ────────────────────────────────────────────────────────
  // Returning early when off-socket is what UNSUBSCRIBES, which is also what
  // narrows the socket's derived topic scope — the card stops asking for `gex`
  // the moment it stops reading it.
  const spotRef = useRef(0)
  useEffect(() => {
    if (!onSocket) return
    return watchFrame<GexFrame>('gex', (frame) => {
      const d = frame?.data
      if (d) push(d.gexRows, spotRef.current, symbol)
    })
  }, [onSocket, push, symbol])

  useEffect(() => {
    if (!onSocket) return
    return watchFrame<SpotFrame>('spot', (frame) => {
      const px = frame?.data.spot
      if (typeof px !== 'number' || !(px > 0)) return
      spotRef.current = px
      const m = modelRef.current
      if (m.rows.length) push(m.rows, px, symbol)
    })
  }, [onSocket, push, symbol])

  // ── Everything else: the chain ─────────────────────────────────────────────
  const chainQ = useQuery<unknown>(onSocket ? null : chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const chain = useMemo(() => (onSocket ? EMPTY_CHAIN_GEX : chainToGex(chainQ.data)), [onSocket, chainQ.data])

  useEffect(() => {
    if (onSocket) return
    push(chain.rows, chain.spot, symbol)
  }, [onSocket, chain, push, symbol])

  // A symbol change must not leave the previous ticker's ladder on screen while
  // the next source warms up.
  useEffect(() => {
    spotRef.current = 0
    push(null, 0, symbol)
  }, [symbol, push])

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
          Net GEX · OI+VOL{onSocket ? '' : ' · chain'}
        </span>
        <span
          className={[
            'tabular font-mono text-[11px] font-extrabold',
            total == null ? 'text-muted opacity-50' : total >= 0 ? 'text-gexbar-pos' : 'text-gexbar-neg',
          ].join(' ')}
        >
          {total == null ? '—' : fmtGexShort(total)}
        </span>
      </CardToolbar>

      <div className="relative min-h-0 flex-1">
        <ChartFrame
          onMount={onMount}
          onResize={onResize}
          onVisibility={onVisibility}
          className="absolute inset-0"
        />
        {total == null && (
          <span className="pointer-events-none absolute left-1 top-1 text-[10px] text-muted opacity-50">
            {onSocket ? 'Waiting for the feed…' : `Loading ${symbol}'s chain…`}
          </span>
        )}
      </div>
    </div>
  )
}
