// ─────────────────────────────────────────────────────────────────────────────
// The status strip: the level tiles, then the legend, in one band.
//
// A TILE WITH NOTHING TO SAY DOES NOT APPEAR. Twin levels share one card, and a
// box only shows up when it has a number — so the Volt tile absorbs the call
// wall when they are the same strike rather than printing it twice.
//
// THREE THINGS THAT LOOK ARBITRARY AND ARE NOT:
//
//  1. The tiles read `aggOi` — they are ALWAYS the open-interest board, even
//     when the map above is weighted by today's volume. Every tile is titled
//     with its basis, and the VOLUME switch stays lit, because a ★ Volt quoted
//     off the wrong basis is the one mistake here that travels: someone reading
//     a shared screenshot cannot scroll up to the switch.
//  2. `Gamma Flip` prints the word "none" rather than going blank when the
//     scope is one-sided. A blank number reads as one that failed to load.
//  3. Whether a wall is a CEILING is checked against price, not assumed from
//     its name. The heaviest call strike can sit below price, and then it is
//     not a ceiling from here — the tooltip has to say so.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { T, alpha, VIOLET, LEVEL_COLORS, V2W } from '@/design/theme'
import { distText, fmtStrike, fmtVal } from './derive'
import type { Derived } from './derive'
import type { BoardMap, BoardMode } from './types'
import { Legend } from './Legend'

export interface StatBandProps {
  board: BoardMap
  d: Derived
  mode: BoardMode
  onJump?: (strike: number) => void
}

export function StatBand({ board, d, mode, onJump }: StatBandProps) {
  const a = d.aggOi
  const spot = board.spot
  const tag = d.scopeTag

  /** Is this wall on the side its name claims, from where price is now? */
  const onItsSide = (k: number | null, ceiling: boolean) =>
    k == null || !(spot > 0) ? true : ceiling ? k >= spot : k <= spot

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{ background: V2W.panelBg, borderTop: `1px solid ${T.border}` }}
    >
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Tile
          label={`Net ${mode} · ${tag}`}
          value={fmtVal(a.netTotal)}
          color={a.netTotal >= 0 ? T.green : T.red}
          hint={a.netTotal >= 0 ? 'Positive Gamma' : 'Negative Gamma'}
          title={`${
            d.cols.length < board.cols.length
              ? `Only the ${tag} expirations, added together`
              : 'Every expiration on the board added together'
          }, across the full strike range. Change the dates and this number changes with it. Positive means moves tend to grind; negative means they stretch further.`}
        />

        {a.callWall != null && a.king !== a.callWall && (
          <Tile
            label={`Call Wall · ${tag}`}
            value={`$${fmtStrike(a.callWall)}`}
            color={LEVEL_COLORS.cw}
            hint={distText(a.callWall, spot) ?? 'Strongest Ceiling'}
            onClick={() => onJump?.(a.callWall!)}
            title={
              onItsSide(a.callWall, true)
                ? 'The strongest ceiling: rallies most often stall around here.'
                : 'The heaviest call strike on the board — but it is sitting below price, so it is not a ceiling from here.'
            }
          />
        )}

        {a.putWall != null && a.king !== a.putWall && (
          <Tile
            label={`Put Wall · ${tag}`}
            value={`$${fmtStrike(a.putWall)}`}
            color={LEVEL_COLORS.pw}
            hint={distText(a.putWall, spot) ?? 'Strongest Floor'}
            onClick={() => onJump?.(a.putWall!)}
            title={
              onItsSide(a.putWall, false)
                ? 'The strongest floor: the biggest level below price. In negative gamma, a slide into it tends to speed up and push through rather than stop here.'
                : 'The heaviest put strike on the board — but it is sitting above price, so it is not a floor from here.'
            }
          />
        )}

        {a.king != null && (
          <Tile
            label={`Volt ★ · ${tag}`}
            value={`$${fmtStrike(a.king)}`}
            color={LEVEL_COLORS.cb}
            hint={distText(a.king, spot) ?? 'biggest level'}
            onClick={() => onJump?.(a.king!)}
            title={`The biggest level for the dates you are viewing — the price with the most option activity stacked on it, so it pulls price like a magnet.${
              a.king === a.callWall
                ? onItsSide(a.callWall, true)
                  ? " Today it is also the call wall, the board's strongest ceiling."
                  : ' Today it is also the call wall, though it is sitting below price rather than above it.'
                : ''
            }${
              a.king === a.putWall
                ? onItsSide(a.putWall, false)
                  ? " Today it is also the put wall, the board's strongest floor."
                  : ' Today it is also the put wall, though it is sitting above price rather than below it.'
                : ''
            }`}
          />
        )}

        {a.surge != null && (
          <Tile
            label="Surge ↯ · today"
            value={`$${fmtStrike(a.surge)}`}
            color={T.cyan}
            hint={distText(a.surge, spot) ?? "today's hot spot"}
            onClick={() => onJump?.(a.surge!)}
            title={`Today's aggressive flow on the nearest expiration — where new money is going now. It moves through the session.${
              a.surgeWall != null ? ` Its wall, the heaviest opposite lean, sits at $${fmtStrike(a.surgeWall)}.` : ''
            } Descriptive, never a prediction.`}
          />
        )}

        {a.flip != null && (
          <Tile
            label={`Gamma Flip · ${tag}`}
            value={`$${fmtStrike(a.flip)}`}
            color={VIOLET}
            hint={distText(a.flip, spot) ?? 'Positive ↑ · Negative ↓'}
            onClick={() => onJump?.(a.flip!)}
            title={`Above this line moves tend to grind; below it they stretch further. Drawn where the gamma of the dates you picked crosses zero. It moves when you change the dates.${
              a.flipCrossings > 1 ? ' These dates cross more than once — this is the one nearest price.' : ''
            }`}
          />
        )}

        {/* NO FLIP IS AN ANSWER — it says so out loud rather than going blank. */}
        {a.flip == null && a.oneSided && (
          <Tile
            label={`Gamma Flip · ${tag}`}
            value="none"
            color={VIOLET}
            hint={a.oneSided === 'sticky' ? 'positive gamma the whole way' : 'negative gamma the whole way'}
            title={`These dates have no flip of their own: their gamma stays ${
              a.oneSided === 'sticky' ? 'positive' : 'negative'
            } across every strike they carry, so there is no price where the mood changes. Pick more dates, or Σ all, to see the whole book's line.`}
          />
        )}

        {a.reversal != null && (
          <Tile
            label={`Reversal ↘ · ${tag}`}
            value={`$${fmtStrike(a.reversal)}`}
            color={T.purple}
            hint={distText(a.reversal, spot) ?? 'the far wall'}
            onClick={() => onJump?.(a.reversal!)}
            title="The far wall — the opposite-sign pole a move tends to turn at, weighted so a level backed by comparable neighbours beats a lone spike."
          />
        )}

        {board.em != null && (
          <Tile
            label="± Move"
            value={`±${board.em.toFixed(2)}`}
            color={T.text}
            hint="today · one standard deviation"
            title="How far the options market expects price to move today — one standard deviation, so it holds about 2 days in 3. Fixed at the open. A statistic, not a forecast."
          />
        )}

        {board.atmIv != null && (
          <Tile
            label={`ATM IV · ${board.cols[0]?.label ?? ''}`}
            value={`${(board.atmIv * 100).toFixed(1)}%`}
            color={T.muted}
            title={`The market's current "how jumpy" setting — the expected move is worked out from it. Read from the nearest expiration whichever dates the board is showing.`}
          />
        )}
      </div>

      <Legend />
    </div>
  )
}

interface TileProps {
  label: ReactNode
  value: ReactNode
  color: string
  hint?: ReactNode
  title?: string
  onClick?: () => void
}

function Tile({ label, value, color, hint, title, onClick }: TileProps) {
  return (
    <div
      title={title}
      onClick={onClick}
      className={onClick ? 'cursor-pointer rounded-lg px-2.5 py-2' : 'rounded-lg px-2.5 py-2'}
      style={{ background: V2W.tilePlate, border: `1px solid ${alpha(T.border, 0.8)}` }}
    >
      <div className="text-3xs text-muted">{label}</div>
      <div className="tabular text-base font-medium leading-tight" style={{ color }}>
        {value}
      </div>
      {hint && <div className="text-3xs text-faint">{hint}</div>}
    </div>
  )
}
