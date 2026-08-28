import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

// The only container in the app. If something needs a border and a background,
// it is a Card — there is no second way to draw a panel.

// ─────────────────────────────────────────────────────────────────────────────
// ONE TOOLBAR PER CARD.
//
// A card gets one bar of controls and it is the header it already has. Card
// BODIES used to draw their own row of buttons directly under that header, so
// every card with settings showed two stacked bars — one carrying its name and
// nothing else, one carrying its controls — and the chart or ladder underneath
// lost two rows of height to say the same thing twice.
//
// A portal slot rather than a `toolbar` prop on CardDef, because the cards that
// have controls are the lazy() ones: the catalog cannot hand BoardPage a
// toolbar out of a module it has not imported yet. A body renders <CardToolbar>
// wherever it likes in its own tree and the contents land in the header the
// moment that body mounts, with its own state, context and handlers intact —
// a portal moves the DOM, not the React tree.
// ─────────────────────────────────────────────────────────────────────────────

interface ToolbarSlot {
  /** null until the header commits. Inside a Card but not ready yet. */
  host: HTMLElement | null
}

/**
 * null means "not inside a Card at all" — a preview, a test, a page rendering a
 * card body bare. That is a different case from "inside a Card whose header has
 * not committed yet", and telling them apart is what stops the toolbar painting
 * one frame inline before it jumps into the header.
 */
const ToolbarSlotContext = createContext<ToolbarSlot | null>(null)

export function CardToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext)
  if (!slot) return <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>
  return slot.host ? createPortal(children, slot.host) : null
}

export interface CardProps {
  title?: ReactNode
  /** Small right-aligned controls in the header. */
  actions?: ReactNode
  /** Painted from cache, no live frame yet. Dims the body. */
  stale?: boolean
  /** Remove body padding — for charts and tables that go edge to edge. */
  flush?: boolean
  /** Fill available height rather than sizing to content. */
  fill?: boolean
  className?: string
  children: ReactNode
}

export function Card({
  title,
  actions,
  stale = false,
  flush = false,
  fill = false,
  className = '',
  children,
}: CardProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const slot = useMemo<ToolbarSlot>(() => ({ host }), [host])

  // The header is where a body's <CardToolbar> lands, so a Card that renders no
  // header has no slot and CardToolbar falls back to drawing inline. Every card
  // on the board carries a title, so in practice the slot is always there.
  const header = title || actions

  return (
    <section
      className={[
        'flex flex-col overflow-hidden rounded-md border border-line bg-surface',
        fill ? 'min-h-0 flex-1' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {header && (
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5">
          <h2 className="shrink-0 text-sm font-medium text-muted">{title}</h2>
          {/* The body's toolbar. Empty when the card has no controls, in which
              case it is just the spacer that keeps `actions` on the right. */}
          <div ref={setHost} className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5" />
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <ToolbarSlotContext.Provider value={header ? slot : null}>
        <div
          className={[
            'flex min-h-0 flex-1 flex-col',
            flush ? '' : 'p-3',
            stale ? 'stale' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </ToolbarSlotContext.Provider>
    </section>
  )
}
