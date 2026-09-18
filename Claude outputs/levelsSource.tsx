import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useQuery } from '@/data/api'
import { useLiveGex } from '@/data/liveGex'
import { isSocketSymbol } from '@/data/symbol'
import type { GexRow } from '@/contract/frames'
import type { CoreNode } from '@/data/levels'
import { chainGexUrl, chainToGex } from '../chainGex'

// ─────────────────────────────────────────────────────────────────────────────
// WHERE A LADDER COMES FROM, once, for everyone who needs one.
//
// Lifted out of KeyLevelsCard on 2026-09-18 unchanged. The card is no longer
// the only thing that wants rows-and-spot for the page symbol: the camera's
// Stats row has to be shootable from any page, and it gets there by mounting a
// probe (board/keyLevels/KeyLevelsStatsProbe.tsx) that needs exactly this and
// none of the drawing. One copy of the SPX/everything-else split, so the two
// cannot disagree about which feed answers for a ticker.
// ─────────────────────────────────────────────────────────────────────────────

/** What a consumer needs, whichever source produced it. */
export interface LevelsSource {
  rows: GexRow[]
  callWall: number | null
  putWall: number | null
  core: CoreNode | null
  flip: number | null
  spot: number
}

/**
 * ── SPX: the socket ────────────────────────────────────────────────────────
 * A COMPONENT rather than a branch inside the card, because `useField` cannot
 * be called conditionally and subscribing to a frame the board is not showing
 * is not free: the socket derives its `?topics=` from what is actually
 * subscribed, so an unconditional useField('gex') would keep pulling SPX frames
 * across the wire on a board that is looking at AMZN. Not mounting the
 * component is what unsubscribes.
 */
export function SocketLevels({ render }: { render: (s: LevelsSource) => ReactNode }) {
  // useLiveGex, NOT the raw `gex` frame. The hook is the ONE place the walls,
  // the CORE and the flip are derived (data/levels.ts) — this card used to pull
  // the frame's own callWall/putWall/gexFlip and then patch them locally, which
  // is how it and the premarket rail ended up printing different levels off one
  // feed. It subscribes to the same frames this component did, so the topic
  // scope is unchanged.
  const g = useLiveGex()
  return (
    <>
      {render({
        rows: g.chain as unknown as GexRow[],
        callWall: g.callWall,
        putWall: g.putWall,
        core: g.core,
        flip: g.flip,
        spot: g.spot,
      })}
    </>
  )
}

/** Every other symbol: the same ladder, derived from its option chain. */
export function ChainLevels({ symbol, render }: { symbol: string; render: (s: LevelsSource) => ReactNode }) {
  // 15s, the cadence Multi Greek polls its ladders on. `staleMs` alone would
  // never refetch — it is a cache TTL, not an interval.
  const q = useQuery<unknown>(chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const chain = useMemo(() => chainToGex(q.data), [q.data])
  return <>{render(chain)}</>
}

/**
 * The split itself. Keyed by symbol so a source swap remounts rather than
 * carrying the previous ticker's rows into the next one's first render.
 */
export function LevelsFor({ symbol, render }: { symbol: string; render: (s: LevelsSource) => ReactNode }) {
  return isSocketSymbol(symbol) ? (
    <SocketLevels key={symbol} render={render} />
  ) : (
    <ChainLevels key={symbol} symbol={symbol} render={render} />
  )
}
