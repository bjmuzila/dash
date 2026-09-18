import { usePageSymbol } from '@/data/symbol'
import type { GexRow } from '@/contract/frames'
import { LevelsFor } from './levelsSource'
import { useKeyLevelsStatsTarget } from './statsShot'

// ─────────────────────────────────────────────────────────────────────────────
// THE STATS PROBE — the Key Levels ladder, with nothing drawn.
//
// The camera's Stats row has to work from every page and must NOT drag you to
// the home board to do it (Brandon, 2026-09-18). It is text, so there is no
// reason it should need pixels: mounting this for the length of the click gets
// the same rows-and-spot the card gets, publishes the same target off the same
// derivation, and unmounts.
//
// MOUNTED ONLY WHILE A SHOT IS ARMED — see `probe` in shell/shotAtlas.ts and
// the probe slot in shell/CopyShot.tsx. It is lazy() for the same reason the
// capture engine is: this pulls the chain math and (on SPX) a socket
// subscription, and neither belongs in the entry chunk or on the wire on a page
// that never asks for it.
//
// It renders null. Do not give it anything to draw — a probe that paints is a
// card, and the card already exists.
// ─────────────────────────────────────────────────────────────────────────────

function Publish({ symbol, rows, spot }: { symbol: string; rows: GexRow[]; spot: number }) {
  useKeyLevelsStatsTarget(symbol, rows, spot)
  return null
}

export default function KeyLevelsStatsProbe() {
  const { symbol } = usePageSymbol()
  return <LevelsFor symbol={symbol} render={(s) => <Publish symbol={symbol} rows={s.rows} spot={s.spot} />} />
}
