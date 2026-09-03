import type { ReactNode } from 'react'
import { Card } from '@/design/primitives/Card'
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
// BE that Card's title collapses them into one row: name on the left and the
// card's own controls to the right of it.
//
// The APP toolbar is above this shell, drawn by src/shell/Shell.tsx — the same
// component the desktop draws. This header is the CARD's, not the app's, and
// nothing that belongs to the app (the brand, the clock, the account menu, the
// board's ticker) goes in it.
//
// `chrome="bare"` is the other case: /m/em renders a v3 PAGE, which already
// draws its own chrome. It gets no Card at all — an outer header over a page
// that has one is the same doubled bar seen from the other side.
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
  /** Right-aligned header content. */
  right?: ReactNode
  /** Pinned under the header — chips, filters, a search box. */
  sticky?: ReactNode
  /** true = the body is exactly the remaining height and does not scroll. */
  fill?: boolean
  /**
   * `card` wraps the body in a Card, which is what gives a board card's
   * <CardToolbar> somewhere to land. `bare` renders the body directly, for a
   * v3 page that draws its own chrome.
   */
  chrome?: 'card' | 'bare'
  children: ReactNode
}

export function MobileShell({
  title,
  right,
  sticky,
  fill = false,
  chrome = 'card',
  children,
}: MobileShellProps) {
  const bodyClass = fill
    ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
    : 'flex min-h-0 flex-1 flex-col overflow-y-auto'

  // The ticker control is NOT here. It lives in the app toolbar above this
  // shell (src/shell/Shell.tsx), which the phone build now draws — and on /m/*
  // it is hidden there too, because every phone screen is pinned to SPX for
  // now. One place decides that; a second copy in this header would be a second
  // place to forget.
  const actions = right ?? undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {chrome === 'card' ? (
        <Card
          title={title}
          actions={actions}
          fill
          flush
          // Full-bleed on a phone. Every edge of the plate would be drawing a
          // line something else already draws — the app toolbar's bottom border
          // above it, the tab bar's top border below, the screen itself at the
          // sides — and its corner radius would round against a flat screen
          // edge. Inline rather than an override class: Card composes its own
          // `rounded-md border` and the winner between two utilities of the
          // same property is decided by stylesheet order, not by which class is
          // written last, so a `rounded-none` here would work or not depending
          // on how Tailwind happened to sort them that build.
          style={{ borderRadius: 0, borderWidth: 0 }}
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
