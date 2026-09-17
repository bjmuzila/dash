import type { ReactNode } from 'react'

// Blank on purpose — this is the frame every route sits in, and it is where
// your page-level layout decisions will live once you start designing.
// It exists now so that no route ever renders a bare <div> with its own
// padding, which is how v2 ended up with twelve different page gutters.

export interface PageProps {
  /** Optional page title row. Omit for full-bleed chart pages. */
  title?: ReactNode
  /** Right-aligned controls in the title row. */
  actions?: ReactNode
  /** true = the page owns the viewport and does not scroll (chart pages). */
  fill?: boolean
  children: ReactNode
}

export function Page({ title, actions, fill = false, children }: PageProps) {
  return (
    <main
      className={
        fill
          ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
          : 'flex min-h-0 flex-1 flex-col overflow-y-auto'
      }
    >
      {(title || actions) && (
        <header className="flex shrink-0 items-center justify-between gap-4 px-4 py-3">
          <h1 className="text-lg font-medium text-fg">{title}</h1>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={fill ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col gap-3 p-4'}>
        {children}
      </div>
    </main>
  )
}
