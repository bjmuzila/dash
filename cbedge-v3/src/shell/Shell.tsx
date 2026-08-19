import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { preload } from '@/data/api'

// The persistent frame: it mounts once and never unmounts, so the socket, the
// store and any dock state survive navigation. Routes render inside it.
//
// Almost blank on purpose — this is yours to design. The one thing worth
// keeping is the preload-on-intent behaviour below.

export interface NavItem {
  to: string
  label: string
  /** URLs to start fetching when the user shows intent (hover/touch). */
  prefetch?: string[]
}

// Add routes here as you build them. Keeping the list in one place means the
// nav and the router can be checked against each other — see the note in
// App.tsx about v2's silent catch-all bug.
export const NAV: NavItem[] = [{ to: '/', label: 'Home' }]

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="cb-viewport flex flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        <span className="mr-3 text-sm font-semibold tracking-tight">CB Edge</span>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // Intent-based prefetch. By the time the click lands the request
              // is usually already back — this is the cheapest perceived-speed
              // win in the whole app.
              onPointerEnter={() => item.prefetch?.forEach((u) => preload(u))}
              className={({ isActive }) =>
                [
                  'rounded-sm px-2.5 py-1 text-sm transition-colors',
                  isActive ? 'bg-raised text-fg' : 'text-muted hover:text-fg',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {children}
    </div>
  )
}
