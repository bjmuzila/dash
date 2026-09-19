// ─────────────────────────────────────────────────────────────────────────────
// The Session Read — the board, in plain English.
//
// This is the product's differentiator and it has one hard rule: it DESCRIBES
// and it never advises. No buy, no sell, no signal, no "watch for a long here".
// Every sentence is a statement about where the levels are and what that
// arrangement usually means, and every one of them is derived from the same
// `agg` the tiles and the grid read — so the ribbon can never describe a board
// that is not the one on screen.
//
// Each line is also allowed to be ABSENT. A board with no flip gets no flip
// sentence rather than a sentence explaining its absence, because the tile
// beside it already says "none" and saying it twice is how a ribbon turns into
// a wall of text nobody reads.
// ─────────────────────────────────────────────────────────────────────────────

import { T, alpha, VIOLET, LEVEL_COLORS, V2W } from '@/design/theme'
import { fmtStrike, fmtVal, flipSideOf } from './derive'
import type { Derived } from './derive'
import type { BoardMap } from './types'

export interface SessionReadProps {
  board: BoardMap
  d: Derived
}

export function SessionRead({ board, d }: SessionReadProps) {
  const a = d.aggOi
  const spot = board.spot
  const side = flipSideOf(a.flip, spot)
  const sticky = a.netTotal >= 0

  const lines: Array<{ mark: string; color: string; text: string }> = []

  lines.push({
    mark: sticky ? '●' : '●',
    color: sticky ? T.green : T.red,
    text: sticky
      ? `Positive gamma across ${d.scopeTag} (${fmtVal(a.netTotal)}). Dealers lean against moves, so ranges tend to hold and pushes tend to grind rather than run.`
      : `Negative gamma across ${d.scopeTag} (${fmtVal(a.netTotal)}). Dealers move with price, so a push tends to stretch further than the size behind it suggests.`,
  })

  if (a.king != null) {
    lines.push({
      mark: '★',
      color: LEVEL_COLORS.cb,
      text: `The Volt is $${fmtStrike(a.king)} — the price with the most option activity stacked on it${
        spot > 0
          ? `, ${Math.abs(a.king - spot).toFixed(2)} ${a.king >= spot ? 'above' : 'below'} where price is now`
          : ''
      }. Levels that size tend to pull price toward them into expiration.`,
    })
  }

  if (a.flip != null && side) {
    lines.push({
      mark: '⚡︎',
      color: VIOLET,
      text: `The gamma flip is $${fmtStrike(a.flip)} and price is ${side} it. ${
        side === 'above'
          ? 'On this side moves usually grind.'
          : 'On this side moves usually stretch further.'
      }${a.flipCrossings > 1 ? ' These dates cross more than once; this is the crossing nearest price.' : ''}`,
    })
  }

  if (a.callWall != null && a.putWall != null) {
    lines.push({
      mark: '▲▼',
      color: T.muted,
      text: `The heaviest strikes sit at $${fmtStrike(a.putWall)} and $${fmtStrike(
        a.callWall,
      )}. Between them is where most of the book is, and where price has spent most of its time.`,
    })
  }

  if (a.surge != null) {
    lines.push({
      mark: '↯',
      color: T.cyan,
      text: `Today's flow is concentrated at $${fmtStrike(a.surge)}${
        a.surgeWall != null ? `, with the heaviest opposite lean at $${fmtStrike(a.surgeWall)}` : ''
      }. This one moves through the session — it is today's tape, not the settled book.`,
    })
  }

  if (a.air.length >= 3) {
    const lo = Math.min(...a.air)
    const hi = Math.max(...a.air)
    lines.push({
      mark: '≋',
      color: T.faint,
      text: `Thin between $${fmtStrike(lo)} and $${fmtStrike(hi)} — very little is stacked there, so price tends to travel through that stretch quickly rather than pause in it.`,
    })
  }

  return (
    <div
      className="shrink-0 px-4 py-2.5"
      style={{ background: V2W.panelBg, borderBottom: `1px solid ${T.border}` }}
    >
      <div className="flex flex-col gap-1">
        {lines.map((l, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-px w-5 shrink-0 text-2xs" style={{ color: l.color }}>
              {l.mark}
            </span>
            <span className="text-xs text-fg">{l.text}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-3xs" style={{ color: alpha(T.text, 0.45) }}>
        Market analytics for educational purposes. Nothing here is investment advice.
      </div>
    </div>
  )
}
