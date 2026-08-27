import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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
  /** No page behind this icon yet — dimmed, not draggable to elsewhere, not
   *  a link. Reproduces the full v2 toolbar icon set ahead of the pages
   *  actually being built (App.tsx's rule against a silent catch-all means a
   *  real <NavLink> to a route that doesn't exist yet would 404, which is a
   *  worse lie than an icon that plainly says "not yet"). Flip this to false
   *  the same day the route lands in App.tsx. */
  comingSoon?: boolean
}

// The full icon set from v2's toolbar (GlobalToolbar.tsx NAV_ITEMS), so the
// rail is recognizable from day one. Only "/" has a page behind it in v3 so
// far — see the `comingSoon` note above. Add routes here as you build them;
// this list is also what NavLink/App.tsx get checked against, per the note
// in App.tsx about v2's silent catch-all bug.
export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/mult-greek', label: 'Multi Greek', icon: '🧮', comingSoon: true },
  { to: '/traders-dashboard', label: 'Traders Dash', icon: '📊', comingSoon: true },
  { to: '/premarket', label: 'Premarket', icon: '🌅', comingSoon: true },
  { to: '/board', label: 'Board', icon: '🧩', comingSoon: true },
  { to: '/options-chain', label: 'Options Chain', icon: '⛓️', comingSoon: true },
  { to: '/em', label: 'Est. Moves', icon: '↔️', comingSoon: true },
  { to: '/analytics', label: 'Analysis', icon: '📈', comingSoon: true },
  { to: '/replay', label: 'Replay', icon: '⏱️', comingSoon: true },
  { to: '/flow', label: 'Flow', icon: '🌊', comingSoon: true },
  { to: '/es-candles', label: 'ES Candles', icon: '🕯️', comingSoon: true },
  { to: '/scanner', label: 'Scanner', icon: '🔍', comingSoon: true },
  { to: '/ict', label: 'ICT', icon: '🎯', comingSoon: true },
  { to: '/test', label: 'Test Lab', icon: '⚗️', comingSoon: true },
  { to: '/trading', label: 'Journal', icon: '📓', comingSoon: true },
]

function Logo() {
  return (
    <div className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-bg">
      CB
    </div>
  )
}

// Drag-to-reorder for the rail — mirrors v2's GexGroupNav, rewritten fresh for
// v3 (native HTML5 drag/drop, no v2 import). Order is saved per browser and
// survives reloads; any icon can move regardless of comingSoon, since the
// arrangement is about which page matters most to YOU, not which ones exist.
const RAIL_ORDER_KEY = 'cb-v3-rail-order'

function loadOrder(): string[] {
  const fallback = NAV.map((n) => n.to)
  try {
    const raw = localStorage.getItem(RAIL_ORDER_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(saved)) return fallback
    const known = new Set(fallback)
    const kept = saved.filter((t): t is string => typeof t === 'string' && known.has(t))
    const missing = fallback.filter((t) => !kept.includes(t))
    return [...kept, ...missing]
  } catch {
    return fallback
  }
}

function Rail() {
  const [order, setOrder] = useState<string[]>(() => loadOrder())
  const dragId = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const persist = (next: string[]) => {
    setOrder(next)
    try {
      localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(next))
    } catch {
      /* best-effort */
    }
  }

  const onDrop = (targetTo: string) => {
    const src = dragId.current
    setDragging(null)
    if (!src || src === targetTo) return
    const from = order.indexOf(src)
    const to = order.indexOf(targetTo)
    if (from < 0 || to < 0) return
    const next = [...order]
    next.splice(from, 1)
    next.splice(to, 0, src)
    persist(next)
  }

  const items = order.map((to) => NAV.find((n) => n.to === to)).filter((n): n is NavItem => !!n)

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-rail py-3">
      <Logo />
      {items.map((item) => {
        const shared =
          'flex w-14 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-center transition-colors'
        const body = (
          <>
            <span aria-hidden className="text-base leading-none">
              {item.icon}
            </span>
            <span className="max-w-full truncate text-[9px] font-semibold leading-tight">{item.label}</span>
          </>
        )
        const dragProps = {
          draggable: true,
          onDragStart: (e: ReactDragEvent) => {
            dragId.current = item.to
            setDragging(item.to)
            e.dataTransfer.effectAllowed = 'move'
            try {
              e.dataTransfer.setData('text/plain', item.to)
            } catch {
              /* ignore */
            }
          },
          onDragOver: (e: ReactDragEvent) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          },
          onDrop: (e: ReactDragEvent) => {
            e.preventDefault()
            onDrop(item.to)
          },
          onDragEnd: () => setDragging(null),
        }
        const isDragging = dragging === item.to

        if (item.comingSoon) {
          return (
            <div
              key={item.to}
              title={`${item.label} — coming soon`}
              aria-disabled="true"
              className={[shared, 'cursor-grab text-faint opacity-40', isDragging ? 'opacity-20' : ''].join(' ')}
              {...dragProps}
            >
              {body}
            </div>
          )
        }
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onPointerEnter={() => item.prefetch?.forEach((u) => preload(u))}
            className={({ isActive }) =>
              [
                shared,
                'cursor-grab',
                isActive ? 'bg-raised text-accent' : 'text-muted hover:text-fg',
                isDragging ? 'opacity-40' : '',
              ].join(' ')
            }
            {...dragProps}
          >
            {body}
          </NavLink>
        )
      })}
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
