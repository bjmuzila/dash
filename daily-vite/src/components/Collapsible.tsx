import { useState, useId, type ReactNode, type CSSProperties } from 'react'
import { T, label, card, section, MONO } from '../theme'

/**
 * A card that starts CLOSED and opens on tap.
 *
 * Everything below the cash-flow chart on the Money page is reference material:
 * bills you already know about, category budgets, the register. Expanded, they
 * turn one screen of "can I spend anything today" into six screens of scrolling
 * to reach the thing you actually came to do. Closed, the page is the briefing,
 * the tiles, the charts — and a short stack of headers you open when you want
 * one.
 *
 * TWO RULES THIS FOLLOWS
 *
 * 1. A closed card still carries its number. `right` is the whole reason
 *    collapsing is safe: "Past due · 2 · $640" tells you whether to open it, so
 *    nothing is hidden — only the detail is. A collapsed header with just a
 *    title would be strictly worse than the list it replaced.
 *
 * 2. Closed on every page LOAD, not remembered. Deliberate: the default is the
 *    briefing, and a card left open three weeks ago should not quietly become
 *    the default forever. Within a session the state does survive month
 *    navigation — <Budget> keeps this mounted, so paging Jul→Aug with Register
 *    open leaves it open, which is what you want while comparing months.
 *
 * Children are not rendered while closed. That is not an optimisation detail —
 * it is what keeps the closed page cheap, and it means a card whose content is
 * expensive (the register's full month) costs nothing until asked for.
 */
export default function Collapsible({
  title,
  right,
  /** Tints the title — used for "Past due". */
  accent,
  /** 'card' matches the overview cards; 'section' matches the hairline-rule
   *  sections the register and bills lists live in. */
  variant = 'card',
  /** The overview's smaller in-card heading size. */
  small,
  defaultOpen = false,
  children,
}: {
  title: string
  right?: string
  accent?: string
  variant?: 'card' | 'section'
  small?: boolean
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  const titleStyle: CSSProperties = variant === 'card'
    ? {
        fontSize: small ? 10.5 : 12, fontWeight: 800,
        letterSpacing: small ? '0.1em' : '0.14em', textTransform: 'uppercase',
        color: accent || T.ink, whiteSpace: 'nowrap',
      }
    : { ...label(accent ? { color: accent } : {}) }

  return (
    <div style={variant === 'card' ? card() : section()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        style={{
          appearance: 'none', background: 'none', border: 'none', padding: 0,
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          // 40px so the header is a comfortable one-handed target in its own
          // right — this is now the primary control on the card.
          minHeight: 40, cursor: 'pointer', textAlign: 'left',
          WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
        }}
      >
        <span style={{ ...titleStyle, flexShrink: 0 }}>{title}</span>
        <span style={{ flex: 1, minWidth: 6 }} />
        {/* The summary shrinks and ellipsises before the title does — on a
            390px screen "Due within 10 days · 4 · $1,240 · 2 late" is close to
            the limit, and losing the tail of the numbers beats wrapping the
            header onto two lines or pushing the chevron off the card. */}
        {right && (
          <span style={{ ...label({ letterSpacing: '0.06em' }),
                         color: accent || T.muted,
                         minWidth: 0, overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {right}
          </span>
        )}
        {/* A chevron, rotated — one glyph that reads as both states, rather than
            swapping + for − and making the control look like two buttons. */}
        <span
          aria-hidden
          style={{
            fontFamily: MONO, fontSize: 12, lineHeight: 1, color: T.muted,
            flexShrink: 0, width: 12, textAlign: 'center',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 140ms ease',
          }}
        >
          ›
        </span>
      </button>

      {open && <div id={id} style={{ marginTop: 4 }}>{children}</div>}
    </div>
  )
}
