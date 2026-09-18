import { useMemo } from 'react'
import type { GexRow } from '@/contract/frames'
import { NO_TARGETS, type CopyShotTarget, useCopyShotTargets } from '@/shell/CopyShot'
import { dexOf, levelsOf, netGexOf } from '../gexChart/values'
import { strikeDp } from './levelsMath'

// ─────────────────────────────────────────────────────────────────────────────
// THE STATS SHOT — six lines of text, not a picture.
//
//   Ticker: SPX
//   Core: 6650
//   Call Wall: 6700
//   Put Wall: 6600
//   Net Gex: +$1.24B
//   Net Dex: -$880.10M
//
// Lifted out of KeyLevelsCard on 2026-09-18 so the camera can take it from ANY
// page without going to the home board (Brandon): the card publishes it while
// it is on screen, and shell/shotAtlas.ts mounts KeyLevelsStatsProbe to publish
// the identical target when it is not. One derivation, two publishers.
//
// The levels are RE-DERIVED here rather than read off the card's props: those
// arrive from data/levels.ts on the OI+VOL basis, and `levelsOf(…, 'vol-only')`
// is the SAME finders run against `volNet` — one definition, other basis, never
// a second local derivation.
//
// Both totals are likewise the whole ladder on VOL. ASCII signs, not the
// U+2212 `fmtGexShort` uses — that minus exists to stop a signed column
// jittering in a table, and outside a table it is a character that pastes
// oddly and does not match a search for "-".
// ─────────────────────────────────────────────────────────────────────────────

// The sign is EXPLICIT on both totals. Positive and negative gamma are two
// different regimes and "which one" is the first thing anyone reads off this
// line — leaving the plus to be inferred from the absence of a minus is exactly
// the ambiguity to avoid in a message someone skims.
function money(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : '+'
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(2)}K`
  return `${sign}$${a.toFixed(0)}`
}

/** Null when the ladder has not arrived — there is nothing honest to copy yet. */
export function keyLevelsStatsText(symbol: string, rows: GexRow[], spot: number): string | null {
  if (!rows.length || !(spot > 0)) return null
  const kDp = strikeDp(rows, spot)
  const volLevels = levelsOf(rows, spot, 'vol-only')
  let gex = 0
  let dex = 0
  for (const r of rows) {
    gex += netGexOf(r, 'vol-only', false)
    dex += dexOf(r, 'vol-only')
  }
  const level = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(kDp))
  return [
    `Ticker: ${symbol}`,
    `Core: ${level(volLevels.core?.strike)}`,
    `Call Wall: ${level(volLevels.callWall)}`,
    `Put Wall: ${level(volLevels.putWall)}`,
    `Net Gex: ${money(gex)}`,
    `Net Dex: ${money(dex)}`,
  ].join('\n')
}

/** Publish the Stats row for as long as there is something to copy. */
export function useKeyLevelsStatsTarget(symbol: string, rows: GexRow[], spot: number): void {
  const targets = useMemo<CopyShotTarget[]>(() => {
    const text = keyLevelsStatsText(symbol, rows, spot)
    if (!text) return NO_TARGETS
    return [
      {
        id: 'key-levels-stats',
        icon: '📋',
        label: 'Stats',
        hint: 'Copy the VOL-only levels as TEXT — ticker, core, both walls, net GEX and net DEX',
        group: 'Home board',
        capture: async () => {
          const { copyText } = await import('@/shell/snapshot')
          return copyText(text)
        },
      },
    ]
  }, [rows, spot, symbol])
  useCopyShotTargets(targets)
}
