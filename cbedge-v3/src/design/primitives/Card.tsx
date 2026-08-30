import type { CSSProperties, ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, SHADOW, V2W } from '@/design/theme'

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

/**
 * THE SURFACE. `v3` is the dark-slate plate every board card and page uses and
 * is the default — passing nothing gets exactly what this component drew before
 * the prop existed.
 *
 * `v2` is the frosted plate v2's `classicCardAccentStyle` draws: a
 * 45%-translucent panel over a 16px blur, a white hairline, an 18px radius and
 * a soft drop shadow. It exists for ONE page — /v3/analytics, a 1:1 port that
 * is required to match v2's colours (see the V2 block in design/theme.ts). It
 * is a variant of this component rather than a second panel implementation
 * precisely because "anything with a border and a background is a Card" has to
 * stay true; a page-local div with its own border would be the thing that rule
 * is there to stop.
 */
export type CardPlate = 'v3' | 'v2'

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
  /** Surface treatment. See CardPlate. Defaults to v3's dark-slate plate. */
  plate?: CardPlate
  /** Outer overrides — height, grid span. Not a licence to restyle the plate. */
  style?: CSSProperties
  className?: string
  children: ReactNode
}

/** v2's classicCardStyle + classicCardAccentStyle, as one object. */
const V2_PLATE: CSSProperties = {
  background: V2W.panelBg,
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderRadius: 18,
  border: `1px solid ${V2W.border}`,
  boxShadow: `0 18px 40px ${alpha(SHADOW, 0.22)}`,
}

export function Card({
  title,
  actions,
  stale = false,
  flush = false,
  fill = false,
  plate = 'v3',
  style,
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
      style={plate === 'v2' ? { ...V2_PLATE, ...style } : style}
      className={[
        'flex flex-col overflow-hidden',
        // The v2 plate carries its own radius, edge and fill as inline style —
        // these utilities would fight it.
        plate === 'v2' ? '' : 'rounded-md border border-line bg-surface',
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
