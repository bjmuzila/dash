// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG — THE TICKER CARD RAIL (parity Part E, as cards).
//
// A horizontal strip of small cards above the log card. Each one is a ticker's
// day summary — spot, the levels in view, the session delta off the 09:29
// baseline, the change count — and clicking it sets THE PAGE SYMBOL, which is
// what the log card underneath draws. So the rail is the selector; there is
// still no second ticker box on this page (see LevelLog.tsx's header note).
//
// WHAT IS A CARD AND WHAT IS NOT. Every tile here is a real `Card` — the rule
// is that anything with a border and a background is one, and a strip of
// hand-rolled bordered divs is exactly the drift that rule exists to stop. They
// are `flush` (their own padding) and `expandable={false}`: a 132px tile blown
// up to fill the page would be six numbers on a wall.
//
// THE × IS NOT A NESTED BUTTON. The card body is one button (select) and the
// remove control is a sibling positioned over it, because a button inside a
// button is invalid HTML and Firefox drops the inner one. SPX / SPY / QQQ get
// no × at all rather than a disabled one — a control that is always dead is a
// control you have to learn to ignore.
//
// COLUMNS FOLLOW THE VIEW SWITCH, in PRICE order (put, call, CORE) — parity
// E11's reasoning: switching to ALL should ADD a line, not reshuffle the two
// already on the card.
// ─────────────────────────────────────────────────────────────────────────────

import { Card } from '@/design/primitives/Card'
import { TickerPicker } from '@/design/primitives/TickerPicker'
import { LEVEL_COLORS, T, alpha } from '@/design/theme'
import {
  RAIL_MAX,
  RAIL_TICKER_RE,
  isRailPinned,
  useRailTickers,
  useWallUniverse,
  type WallTickerRow,
} from '@/pages/levelLog/railStore'
import {
  type ExpScope,
  type GexBasis,
  type LogView,
  type WallLevel,
  inView,
  wallNum,
  wallStrike,
} from '@/pages/levelLog/wallData'

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
      className="tabular ml-1 rounded-sm px-1 font-mono text-3xs font-semibold"
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
  view,
  selected,
  loaded,
  onPick,
  onRemove,
}: {
  sym: string
  row: WallTickerRow | undefined
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
      className="relative w-[132px] shrink-0"
      style={
        selected
          ? { borderColor: alpha(T.cyan, 0.55), background: alpha(T.cyan, 0.1) }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => onPick(sym)}
        aria-pressed={selected}
        title={`Show ${sym}'s level log`}
        className="flex w-full flex-col gap-1 px-2 py-1.5 text-left transition-colors hover:bg-raised"
      >
        <span className="flex items-baseline gap-1">
          <span className="truncate text-xs font-semibold tracking-wide text-fg">{sym}</span>
          {row && row.changes > 0 ? (
            <span className="tabular ml-auto font-mono text-3xs text-faint" title="Level changes recorded today">
              {row.changes}×
            </span>
          ) : null}
        </span>

        <span className="tabular font-mono text-sm text-fg">{wallNum(row?.spot)}</span>

        <span className="flex flex-col gap-0.5">
          {cols.map((lt) => (
            <span key={lt} className="flex items-baseline gap-1">
              <span
                className="shrink-0 text-3xs font-semibold uppercase tracking-wide"
                style={{ color: LEVEL_TOKEN[lt] }}
              >
                {LEVEL_LABEL[lt]}
              </span>
              <span
                className="tabular ml-auto font-mono text-2xs"
                style={{ color: LEVEL_TOKEN[lt] }}
              >
                {wallStrike(row?.[lt] ?? null)}
              </span>
              <Delta now={row?.[lt] ?? null} open={row?.open?.[lt]} />
            </span>
          ))}
        </span>

        {/* Only once a response has landed — before that an empty card is
            "not yet", not "nothing recorded", and saying so would be a lie
            that resolves itself in half a second. */}
        {loaded && !row ? (
          <span className="text-3xs text-faint">no rows</span>
        ) : null}
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
  const { rows, loaded } = useWallUniverse(date, nonce, scope, basis)

  const full = tickers.length >= RAIL_MAX

  return (
    <section className="flex shrink-0 flex-col gap-1">
      <div className="flex items-baseline gap-2 px-0.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
          Tickers — {date}
        </span>
        <span className="tabular font-mono text-2xs text-faint">
          {loaded ? tickers.length : '…'}
        </span>
        <button
          type="button"
          onClick={reset}
          title="Back to the default rail"
          className="ml-auto rounded-sm px-1 text-2xs text-faint transition-colors hover:bg-raised hover:text-fg"
        >
          Reset
        </button>
      </div>

      {/* Horizontal only. The rail is a strip; wrapping it to a second line is
          how a strip turns back into the table this replaced. */}
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {tickers.map((sym) => (
          <RailCard
            key={sym}
            sym={sym}
            row={rows.get(sym)}
            view={view}
            selected={sym === symbol}
            loaded={loaded}
            onPick={onPick}
            onRemove={remove}
          />
        ))}

        {/* The universe picker, not a free text box: it is the same control the
            app toolbar uses, so a symbol starred here is starred there. It
            still accepts an off-universe symbol (allowCustom) for the same
            reason the toolbar does — the scanner list is the server's
            watchlist, not the set of symbols the app can price. */}
        <div className="flex shrink-0 items-center pl-1">
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
        </div>
      </div>
    </section>
  )
}
