// ─────────────────────────────────────────────────────────────────────────────
// THE INDEX ↔ FUTURE PAIRS — what the GEX Candles card's tape switch knows.
//
// 2026-09-02 the switch was SPX/ES only. 2026-09-24 NDX/NQ joined it: NDX
// gamma drawn over NQ futures candles, every strike shifted by the NQ−NDX
// basis, exactly as SPX gamma is drawn over ES. Everything that used to be
// spelled "ES" inside the card is read off one of these rows instead, so a
// third pair is a row here plus a basis route on the server.
//
//   index        the gamma key the pair belongs to (`SymbolDef.gexSymbol`)
//   fut          the futures product, as /api/snapshots/candles?symbol= wants it
//   basisUrl     the daily-anchor basis route (see ./basis.ts)
//   maxBasis     the plausibility ceiling for that basis. NQ's carry is 3-4x
//                ES's in points, so one shared ceiling would either reject
//                every real NQ basis or wave through a broken ES one.
//   frame5m /    the socket frames whose newest bar is the live futures print
//   frame1m      (the forming bar). Own types per interval — never merged.
//   liveSpotPair whether the socket's `spot` frame IS this index, which is
//                what the card's live-basis fallback needs. Only SPX: the
//                socket streams one underlying, so an NQ chart has the route
//                or nothing.
// ─────────────────────────────────────────────────────────────────────────────

export interface FuturesPair {
  index: string
  indexLabel: string
  fut: 'ES' | 'NQ'
  basisUrl: string
  maxBasis: number
  frame5m: 'esCandles' | 'nqCandles'
  frame1m: 'es1mCandles' | 'nq1mCandles'
  liveSpotPair: boolean
}

const PAIRS: FuturesPair[] = [
  {
    index: '$SPX',
    indexLabel: 'SPX',
    fut: 'ES',
    basisUrl: '/proxy/es-spx-basis',
    maxBasis: 250,
    frame5m: 'esCandles',
    frame1m: 'es1mCandles',
    liveSpotPair: true,
  },
  {
    index: 'NDX',
    indexLabel: 'NDX',
    fut: 'NQ',
    basisUrl: '/proxy/nq-ndx-basis',
    maxBasis: 600,
    frame5m: 'nqCandles',
    frame1m: 'nq1mCandles',
    liveSpotPair: false,
  },
]

const BY_INDEX = new Map(PAIRS.map((p) => [p.index, p]))

/** The futures pair for a gamma key, or null when the symbol has no future. */
export function futuresPairFor(gexSymbol: string): FuturesPair | null {
  return BY_INDEX.get(gexSymbol) ?? null
}
