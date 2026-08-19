import type { ReactNode } from 'react'

// The only container in the app. If something needs a border and a background,
// it is a Card — there is no second way to draw a panel.

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
      {(title || actions) && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
          <h2 className="text-sm font-medium text-muted">{title}</h2>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
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
    </section>
  )
}
