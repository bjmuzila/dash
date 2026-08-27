import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { preload } from '@/data/api'

// The persistent frame: mounts once and never unmounts, so the socket, the
// store and any dock state survive navigation. Routes render inside it.
//
// Left icon rail + top toolbar, styled after the dark-slate reference mockup
// (20260818darkslatecardtheme.html) — rail on --color-rail, toolbar band on
// --color-bg, everything else sourced from src/design/tokens.css. No colour
// literal appears below; that rule is what stopped v2 having a coherent look.

export interface NavItem {
  to: string
  label: string
  /** Rail icon — a single emoji glyph, matching v2's nav-icon language. */
  icon: string
  /** URLs to start fetching when the user shows intent (hover/touch). */
  prefetch?: string[]
}

// Add routes here as you build them. Keeping the list in one place means the
// nav and the router can be checked against each other — see the note in
// App.tsx about v2's silent catch-all bug.
export const NAV: NavItem[] = [{ to: '/', label: 'Terminal', icon: '🏠' }]

function Logo() {
  return (
    <div className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-bg">
      CB
    </div>
  )
}

function Rail() {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-rail py-3">
      <Logo />
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onPointerEnter={() => item.prefetch?.forEach((u) => preload(u))}
          className={({ isActive }) =>
            [
              'flex w-14 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-center transition-colors',
              isActive ? 'bg-raised text-accent' : 'text-muted hover:text-fg',
            ].join(' ')
          }
        >
          <span aria-hidden className="text-base leading-none">
            {item.icon}
          </span>
          <span className="max-w-full truncate text-[9px] font-semibold leading-tight">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

// ET clock — the one bit of the toolbar worth being functional immediately;
// everything else there (search, avatar) is a visual placeholder until those
// features exist. Ticks every second, Eastern time (matches v2's toolbar).
function EtClock() {
  const [time, setTime] = useState('--:--:--')
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="tabular shrink-0 text-sm font-semibold text-fg">
      {time} <span className="text-xs text-faint">ET</span>
    </span>
  )
}

function Toolbar() {
  // Typeable now. There's no search backend wired yet (no ticker/strike/expiry
  // lookup exists in src/data/api.ts), so this just holds what you type —
  // Enter is the seam for wiring a real lookup in later.
  const [query, setQuery] = useState('')
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg px-3">
      <span className="text-sm font-semibold tracking-tight">CB Edge</span>
      <div className="flex-1" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ticker, strike, expiry…"
        className="w-64 shrink rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg outline-none placeholder:text-muted focus:border-accent"
      />
      <EtClock />
      {/* Account — decorative placeholder until v3 has its own auth/user menu. */}
      <div
        title="Account — coming soon"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-bold text-fg"
      >
        B
      </div>
    </header>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="cb-viewport flex overflow-hidden bg-bg text-fg">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Toolbar />
        {children}
      </div>
    </div>
  )
}
