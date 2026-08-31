// ─────────────────────────────────────────────────────────────────────────────
// A CARD'S HEADING, when the card is about ONE ticker's ONE contract date.
//
//   AMZN - Key Levels - 8-31-26
//
// Three parts and a fixed order: the symbol the board is on, what the card is,
// and the expiration the numbers were computed from. The date is the part that
// earns this file — a levels board with no expiry on it is a board you cannot
// check against a chain, and "which expiry is this" is the first question asked
// of every gamma number in the product.
//
// One component rather than a template string per card, so every card that
// grows a contract date spells it the same way. `CardDef.Title` in catalog.tsx
// is how a card opts in; a card without one keeps its plain `label`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `2026-08-31` → `8-31-26`. The wire's ISO date, in the form the desk says out
 * loud. Anything that is not an ISO date is passed through untouched rather
 * than reformatted into a guess.
 */
export function fmtContractDate(ymd: string | null | undefined): string {
  if (!ymd) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const [, y = '', mo = '', d = ''] = m
  return `${Number(mo)}-${Number(d)}-${y.slice(2)}`
}

export interface CardHeadingProps {
  /** The board's page symbol. Omitted for a card that follows no ticker. */
  symbol?: string
  /** What the card is — the catalog label. */
  label: string
  /** The contract date, ISO. Omitted (not zero-filled) when it is not known yet. */
  date?: string | null
}

export function CardHeading({ symbol, label, date }: CardHeadingProps) {
  const d = fmtContractDate(date)
  return (
    <>
      {symbol && <span className="font-semibold text-fg">{symbol}</span>}
      {symbol && <span className="text-faint"> - </span>}
      <span>{label}</span>
      {d && <span className="text-faint"> - </span>}
      {d && <span className="tabular">{d}</span>}
    </>
  )
}
