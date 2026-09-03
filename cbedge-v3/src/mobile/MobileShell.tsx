import type { ReactNode } from 'react'
import { Card } from '@/design/primitives/Card'
import { Chip } from '@/design/primitives/Controls'
import { TickerPicker } from '@/design/primitives/TickerPicker'
import { PAGE_TICKER_RE, SOCKET_SYMBOL, isSocketSymbol, usePageSymbol } from '@/data/symbol'
import { MobileTabBar } from './MobileTabBar'

// ─────────────────────────────────────────────────────────────────────────────
// MobileShell — the frame every phone screen renders inside.
//
// Top to bottom:
//   [ header      ]  ONE bar. Never two.
//   [ sticky      ]  optional: chips or filters that stay put while the body scrolls
//   [ body        ]  a scroll region (lists, forms) or a fixed fill (charts)
//   [ MobileTabBar]  fixed to the bottom edge, safe-area aware
//
// ── Why the header is a Card header ──────────────────────────────────────────
// Four of the six screens ARE a board card (see mobileNav.ts). A board card
// publishes its controls through <CardToolbar>, which portals into the header
// of the Card it is mounted in — so if this shell drew its own title bar AND
// wrapped the card, the phone would show two stacked bars, one carrying a name
// and one carrying the buttons, and the chart underneath would lose ~60px of
// the ~600px it has. Wrapping the body in a Card and letting the shell's title
// BE that Card's title collapses them into one row: name on the left, the
// card's own controls in the middle, the ticker on the right.
//
// `chrome="bare"` is the other case: /m/chain and /m/em render v3 PAGES, which
// already draw their own toolbars. They get no Card at all — an outer header
// over a page that has one is the same doubled bar seen from the other side.
//
// ── `fill` ───────────────────────────────────────────────────────────────────
// The important switch, and the same one v2's phone shell had. A chart page
// must NOT scroll: a canvas that owns drag inside a scrollable column means the
// user can neither pan the chart nor scroll the page reliably. Those pages take
// the exact remaining height. List and form pages scroll normally.
// ─────────────────────────────────────────────────────────────────────────────

export interface MobileShellProps {
  /** Header text. With chrome="card" this is the Card's title. */
  title?: string
  /** Right-aligned header content, before the ticker control. */
  right?: ReactNode
  /** Pinned under the header — chips, filters, a search box. */
  sticky?: ReactNode
  /** true = the body is exactly the remaining height and does not scroll. */
  fill?: boolean
  /**
   * Show the board's ticker control in the header. On for anything that follows
   * the page symbol; off for a page that carries its own ticker entry (/m/em).
   */
  symbol?: boolean
  /**
   * `card` wraps the body in a Card, which is what gives a board card's
   * <CardToolbar> somewhere to land. `bare` renders the body directly, for a
   * v3 page that draws its own chrome.
   */
  chrome?: 'card' | 'bare'
  children: ReactNode
}

/**
 * The board's symbol, phone-sized. The same two controls the desktop toolbar
 * carries (src/shell/Shell.tsx) — the SPX chip that says whether the board is
 * on the live socket, and the picker — at `touch` size so both clear the 44px
 * tap floor.
 */
function SymbolControls() {
  const { symbol, setSymbol } = usePageSymbol()
  return (
    <>
      <Chip
        size="touch"
        label={SOCKET_SYMBOL}
        on={isSocketSymbol(symbol)}
        onClick={() => setSymbol(SOCKET_SYMBOL)}
        title="Put every card back on SPX — the one symbol the live socket streams"
      />
      <TickerPicker
        activeTicker={symbol}
        onSelect={setSymbol}
        allowCustom={PAGE_TICKER_RE}
        title="The symbol every screen that can follow a ticker is showing"
      />
    </>
  )
}

export function MobileShell({
  title,
  right,
  sticky,
  fill = false,
  symbol = false,
  chrome = 'card',
  children,
}: MobileShellProps) {
  const bodyClass = fill
    ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
    : 'flex min-h-0 flex-1 flex-col overflow-y-auto'

  const actions = symbol || right ? (
    <>
      {right}
      {symbol && <SymbolControls />}
    </>
  ) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {chrome === 'card' ? (
        <Card
          title={title}
          actions={actions}
          fill
          flush
          // Full-bleed on a phone: the plate's side and bottom edges would only
          // draw a line beside the screen edge and inside the tab bar's own
          // border, and its corner radius would round against a flat screen
          // edge. The top edge is kept — it is the seam under the browser
          // chrome. Inline rather than an override class: Card composes its own
          // `rounded-md border` and the winner between two utilities of the
          // same property is decided by stylesheet order, not by which class is
          // written last, so a `rounded-none` here would work or not depending
          // on how Tailwind happened to sort them that build.
          style={{ borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0, borderBottomWidth: 0 }}
        >
          {sticky && <div className="shrink-0 border-b border-line px-3 py-2">{sticky}</div>}
          <div className={bodyClass}>{children}</div>
        </Card>
      ) : (
        <>
          {(title || actions) && (
            <header className="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-3 py-1.5">
              {title && (
                <h1 className="shrink-0 truncate text-sm font-medium text-muted">{title}</h1>
              )}
              <div className="min-w-0 flex-1" />
              {actions}
            </header>
          )}
          {sticky && <div className="shrink-0 border-b border-line px-3 py-2">{sticky}</div>}
          <div className={bodyClass}>{children}</div>
        </>
      )}
      <MobileTabBar />
    </div>
  )
}

export default MobileShell
