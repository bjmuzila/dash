import type { CSSProperties, ReactNode } from 'react'
import { createContext, useContext, useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, SHADOW, V2W } from '@/design/theme'
import { useExpandStage } from '@/design/primitives/Expand'

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
  if (!slot) return <div className="cb-bar flex shrink-0 items-center gap-1.5">{children}</div>
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
  /**
   * Draw the expand control. ON BY DEFAULT — every card in the app can be blown
   * up to fill the page area (see design/primitives/Expand.tsx). Pass false only
   * for a card that is already the whole page, where expanding is a no-op that
   * still costs a button.
   *
   * The control draws nothing outside an ExpandStageHost, so the phone build,
   * previews and tests need no opt-out.
   */
  expandable?: boolean
  /**
   * Stable key for the expand state, and the card's identity in the DOM
   * (`data-card-instance`). Defaults to a generated id, which is fine for a card
   * that never remounts; the board passes its instance id so a re-render mid-drag
   * cannot drop the expansion, and so a shot target can still find the card while
   * it is expanded and living outside its tile.
   */
  expandId?: string
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
  expandable = true,
  expandId,
  style,
  className = '',
  children,
}: CardProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const slot = useMemo<ToolbarSlot>(() => ({ host }), [host])

  const expandCtx = useExpandStage()
  const autoId = useId()
  const expandKey = expandId ?? autoId
  // The header is where a body's <CardToolbar> lands, so a Card that renders no
  // header has no slot and CardToolbar falls back to drawing inline. Every card
  // on the board carries a title, so in practice the slot is always there. It is
  // also the only place the expand control can go — one toolbar per card.
  const header = title || actions
  const canExpand = expandable && !!header && expandCtx != null
  const expanded = canExpand && expandCtx!.expandedId === expandKey

  // A card that unmounts while expanded — removed from the board, or navigated
  // away from — must not leave the stage holding a key nothing will ever render.
  const collapse = expandCtx?.collapse
  useEffect(() => {
    if (!expanded || !collapse) return
    return () => collapse(expandKey)
  }, [expanded, collapse, expandKey])

  const section = (
    <section
      // Every Card is a photographable surface. `data-card-instance` exists
      // only for a card that was given an expandId, so it cannot be the marker
      // the right-click clip menu walks up to — this one always is.
      // See shell/NoteClipMenu.tsx (resolveClipTarget).
      data-card=""
      data-card-instance={expandId}
      data-card-expanded={expanded ? '' : undefined}
      style={
        expanded
          ? { ...(plate === 'v2' ? V2_PLATE : null), height: '100%', width: '100%' }
          : plate === 'v2'
            ? { ...V2_PLATE, ...style }
            : style
      }
      className={[
        'flex flex-col overflow-hidden',
        // The v2 plate carries its own radius, edge and fill as inline style —
        // these utilities would fight it.
        plate === 'v2' ? '' : 'rounded-md border border-line bg-surface',
        // Expanded, the card owns the stage: it fills it, and the caller's grid
        // span / pixel height (which described a tile that is no longer where
        // this card lives) is dropped above.
        expanded ? 'min-h-0 flex-1' : fill ? 'min-h-0 flex-1' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── THE HEADER IS EXACTLY ONE ROW, ALWAYS ────────────────────────────
          It used to be `flex-wrap`, which meant a card narrower than its own
          controls grew a SECOND header row. The chart below lost 30px, the
          card's proportions changed with its width, and two cards of the same
          size could hold different amounts of chart depending on how many
          buttons their body happened to register. A control bar that changes the
          geometry of the thing it sits on is worse than one you have to scroll.

          So: `nowrap`, plus a fixed `h-8` so the row is the same height whatever
          is in it, and the toolbar scrolls sideways when it does not fit
          (`cb-bar` in tokens.css — overflow-x with the scrollbar hidden, because
          a visible bar would eat a quarter of a 32px header). Nothing becomes
          unreachable; the row just stays a row.

          `min-w-0 shrink truncate` on the title lets the NAME give way first: it
          is repeated in the copy-shot menu and in the card body, and the
          controls are repeated nowhere. ── */}
      {header && (
        <header className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3">
          <h2 className="min-w-0 shrink truncate text-sm font-medium text-muted">{title}</h2>
          {/* The body's toolbar. Empty when the card has no controls, in which
              case it is just the spacer that keeps `actions` on the right. */}
          <div
            ref={setHost}
            className="cb-bar flex min-w-0 flex-1 items-center justify-end gap-1.5"
          />
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
          {canExpand && (
            <button
              type="button"
              onClick={() => (expanded ? expandCtx!.collapse(expandKey) : expandCtx!.expand(expandKey))}
              title={
                expanded
                  ? 'Back to the board (Esc)'
                  : 'Fill the page with this card — the rail and toolbar stay put'
              }
              aria-label={expanded ? 'Collapse card' : 'Expand card'}
              aria-pressed={expanded}
              className="shrink-0 rounded-sm px-1 text-xs leading-none text-faint transition-colors hover:bg-raised hover:text-fg"
            >
              <span aria-hidden>{expanded ? '⤡' : '⤢'}</span>
            </button>
          )}
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

  // Expanded: the same React element, rendered into the page column's stage.
  // The tile it came from keeps its place in the grid and is simply empty for
  // the duration, so collapsing puts the card back exactly where it was.
  return expanded && expandCtx?.stage ? createPortal(section, expandCtx.stage) : section
}
