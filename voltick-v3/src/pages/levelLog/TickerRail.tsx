// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG — THE TICKER CARD RAIL (parity Part E, as cards).
//
// A grid of small cards above the log card, FIVE TO A ROW. Each one draws that
// ticker's actual session — the same wall-migration chart the log card draws,
// in `compact` mode at 62px — under a head carrying the symbol, spot and the
// levels. Clicking a card sets THE PAGE SYMBOL, which is what the log card
// underneath draws. So the rail is the selector; there is still no second
// ticker box on this page (see LevelLog.tsx's header note).
//
// THE CHART IS THE SAME COMPONENT, not a sparkline of its own. A card showing
// only the closing levels answers "where did it end" and hides the one thing
// this page exists for — whether the level HELD while price travelled. Drawing
// it with `WallMigrationChart compact` rather than a mini re-implementation is
// deliberate: the forward fill, the CORE-sign role rule and the y range are the
// parts that must never drift between the big chart and the small one.
//
// FIVE COLUMNS, not a scroller. A horizontal strip meant the cards past the
// fourth were off screen, and a chart you have to scroll to is a chart nobody
// looks at. It steps down to three and then two on narrow windows rather than
// squeezing five 40px plots onto a laptop.
//
// WHAT IS A CARD AND WHAT IS NOT. Every tile is a real `Card` — the rule is that
// anything with a border and a background is one, and a grid of hand-rolled
// bordered divs is exactly the drift that rule exists to stop. They are `flush`
// (their own padding) and `expandable={false}`: the expand control belongs to
// the log card, which is the full-size version of what these are.
//
// THE × IS NOT A NESTED BUTTON. The card body is one button (select) and the
// remove control is a sibling positioned over it, because a button inside a
// button is invalid HTML and Firefox drops the inner one. SPX / SPY / QQQ get
// no × at all rather than a disabled one — a control that is always dead is a
// control you have to learn to ignore.
//
// LEVELS FOLLOW THE VIEW SWITCH, in PRICE order (put, call, CORE) — parity
// E11's reasoning: switching to ALL should ADD a line, not reshuffle the two
// already on the card.
// ─────────────────────────────────────────────────────────────────────────────

import { Card } from '@/design/primitives/Card'
import { TickerPicker } from '@/design/primitives/TickerPicker'
import { LEVEL_COLORS, T, alpha } from '@/design/theme'
import { WallMigrationChart } from '@/pages/levelLog/WallMigrationChart'
import {
  RAIL_MAX,
  RAIL_TICKER_RE,
  isRailPinned,
  useRailDays,
  useRailTickers,
  useWallUniverse,
  type WallTickerRow,
} from '@/pages/levelLog/railStore'
import {
  type DaySlice,
  type ExpScope,
  type GexBasis,
  type LogView,
  type WallLevel,
  inView,
  wallNum,
  wallStrike,
} from '@/pages/levelLog/wallData'

/**
 * Mini plot height. Tall enough that a level holding through a 30-point range is
 * visibly flat against a line that is not, short enough that five cards and the
 * log card share a screen. The big chart's 250 is the same drawing at 2×.
 *
 * DOUBLED from 62 (2026-09-04), and the two halves of that change belong
 * together: at 62px a 1-minute tape put a minute on a third of a pixel, which is
 * why the rail deliberately drew the log's own sparse spot captures instead (see
 * fetchRailDay in railStore.ts). At 124px a minute is worth drawing, so the rail
 * now pairs each log with the real tape and this height is what makes that
 * readable rather than a thicker smudge.
 */
const MINI_H = 124

/** Price order, filtered by the view switch. Parity E11. */
const LEVEL_ORDER: WallLevel[] = ['put_wall', 'call_wall', 'cb']

const LEVEL_LABEL: Record<WallLevel, string> = {
  put_wall: 'PUT',
  call_wall: 'CALL',
  cb: 'CORE',
}

/** wallData's level ids → the theme's three-letter wall colours. */
const LEVEL_TOKEN: Record<WallLevel, string> = {
  put_wall: LEVEL_COLORS.pw,
  call_wall: LEVEL_COLORS.cw,
  cb: LEVEL_COLORS.cb,
}

/**
 * The session delta off the 09:29 baseline — parity E13, including its
 * deliberate asymmetry: UP is green, DOWN is AMBER, not red. Red on this page
 * means "put wall", and a red delta next to a green call wall reads as a level
 * type rather than a direction.
 *
 * Renders nothing when the level has not moved, which is the common case and
 * the one where a chip saying "0" is pure noise.
 */
function Delta({ now, open }: { now: number | null; open: number | undefined }) {
  if (now == null || open == null || now === open) return null
  const up = now > open
  return (
    <span
      className="tabular rounded-sm px-1 font-mono text-3xs font-semibold"
      style={{
        color: up ? T.green : T.orange,
        background: alpha(up ? T.green : T.orange, 0.12),
      }}
      title={`${wallStrike(open)} at the 09:29 open`}
    >
      {up ? '▲' : '▼'}
      {wallStrike(Math.abs(now - open))}
    </span>
  )
}

function RailCard({
  sym,
  row,
  days,
  view,
  selected,
  loaded,
  onPick,
  onRemove,
}: {
  sym: string
  row: WallTickerRow | undefined
  /** That symbol's one-day slice, or undefined until its read lands. */
  days: DaySlice[] | undefined
  view: LogView
  selected: boolean
  loaded: boolean
  onPick: (s: string) => void
  onRemove: (s: string) => void
}) {
  const pinned = isRailPinned(sym)
  const cols = LEVEL_ORDER.filter((lt) => inView(view, lt))

  return (
    <Card
      flush
      expandable={false}
      className="relative"
      style={
        selected ? { borderColor: alpha(T.cyan, 0.55), background: alpha(T.cyan, 0.1) } : undefined
      }
    >
      <button
        type="button"
        onClick={() => onPick(sym)}
        aria-pressed={selected}
        title={`Show ${sym}'s level log`}
        className="flex w-full flex-col gap-1 px-2 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-semibold tracking-wide text-fg">{sym}</span>
          <span className="tabular ml-auto font-mono text-xs text-fg">{wallNum(row?.spot)}</span>
          {row && row.changes > 0 ? (
            <span
              className="tabular font-mono text-3xs text-faint"
              title="Level changes recorded today"
            >
              {row.changes}×
            </span>
          ) : null}
        </span>

        {/* The session itself. `compact` strips the head, legend and clock rail
            — the card's own head above is what names the numbers. A symbol with
            no rows draws nothing at all rather than an empty frame, same as the
            big chart. */}
        <span className="block" style={{ height: MINI_H }}>
          {days ? (
            <WallMigrationChart days={days} view={view} height={MINI_H} compact />
          ) : (
            <span className="flex h-full items-center justify-center text-3xs text-faint">
              {loaded ? 'no session recorded' : 'loading…'}
            </span>
          )}
        </span>

        {/* Levels under the plot, one row, so the card answers "where is it"
            without a hover. */}
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {cols.map((lt) => (
            <span key={lt} className="flex items-baseline gap-1">
              <span
                className="shrink-0 text-3xs font-semibold uppercase tracking-wide"
                style={{ color: LEVEL_TOKEN[lt] }}
              >
                {LEVEL_LABEL[lt]}
              </span>
              <span className="tabular font-mono text-2xs" style={{ color: LEVEL_TOKEN[lt] }}>
                {wallStrike(row?.[lt] ?? null)}
              </span>
              <Delta now={row?.[lt] ?? null} open={row?.open?.[lt]} />
            </span>
          ))}
        </span>
      </button>

      {!pinned && (
        <button
          type="button"
          onClick={() => onRemove(sym)}
          title={`Take ${sym} off the rail`}
          aria-label={`Remove ${sym}`}
          className="absolute right-0.5 top-0.5 rounded-sm px-1 text-2xs leading-none text-faint transition-colors hover:bg-raised hover:text-fg"
        >
          <span aria-hidden>×</span>
        </button>
      )}
    </Card>
  )
}

export function TickerRail({
  date,
  view,
  scope,
  basis,
  nonce,
  symbol,
  onPick,
}: {
  date: string
  view: LogView
  scope: ExpScope
  basis: GexBasis
  /** Bumped by the page's Refresh, so the rail re-reads with the chart. */
  nonce: number
  /** The page symbol — which card reads as selected. */
  symbol: string
  onPick: (s: string) => void
}) {
  const { tickers, add, remove, reset } = useRailTickers()
  // Both reads fire from this one render — the summary that fills the heads and
  // the per-symbol logs the plots draw. Neither waits on the other.
  const { rows, loaded } = useWallUniverse(date, nonce, scope, basis)
  const { days, loaded: daysLoaded } = useRailDays(tickers, date, nonce, scope, basis)

  const full = tickers.length >= RAIL_MAX

  return (
    <section className="flex shrink-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 px-0.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
          Tickers — {date}
        </span>
        <span className="tabular font-mono text-2xs text-faint">{tickers.length}</span>

        <span className="ml-auto flex items-center gap-2">
          {/* The universe picker, not a free text box: it is the same control
              the app toolbar uses, so a symbol starred here is starred there. It
              still accepts an off-universe symbol (allowCustom) for the same
              reason the toolbar does — the scanner list is the server's
              watchlist, not the set of symbols the app can price. */}
          {full ? (
            <span className="text-2xs text-faint" title={`The rail holds ${RAIL_MAX} cards`}>
              rail full
            </span>
          ) : (
            <TickerPicker
              activeTicker=""
              triggerLabel="+ Add"
              title="Add a ticker card to the rail"
              allowCustom={RAIL_TICKER_RE}
              onSelect={add}
            />
          )}
          <button
            type="button"
            onClick={reset}
            title="Back to the default rail"
            className="rounded-sm px-1 text-2xs text-faint transition-colors hover:bg-raised hover:text-fg"
          >
            Reset
          </button>
        </span>
      </div>

      {/* Five to a row on a monitor, stepping down rather than squeezing. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {tickers.map((sym) => (
          <RailCard
            key={sym}
            sym={sym}
            row={rows.get(sym)}
            days={days.get(sym)}
            view={view}
            selected={sym === symbol}
            loaded={loaded && daysLoaded}
            onPick={onPick}
            onRemove={remove}
          />
        ))}
      </div>
    </section>
  )
}
