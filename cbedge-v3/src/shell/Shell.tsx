import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { preload } from '@/data/api'
import { AuthProvider } from '@/data/auth'
import { PAGE_TICKER_RE, PageSymbolProvider, SOCKET_SYMBOL, isSocketSymbol, usePageSymbol } from '@/data/symbol'
import { Chip } from '@/design/primitives/Controls'
import { TickerPicker } from '@/design/primitives/TickerPicker'
import { UserMenu } from '@/shell/UserMenu'

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

// v3's rail. It started as a copy of v2's toolbar icon set so the rail was
// recognizable from day one; seven of those slots came back out on 2026-08-30 —
// Scanner, Test Lab and Journal (built, now retired) and Multi Greek, Board,
// ES Candles and ICT (never more than a dimmed "coming soon" icon). v3 is not
// shipping those pages, and an icon for a page nobody is going to build is the
// same lie `comingSoon` exists to avoid.
//
// The BOARD CARDS named Multi Greek / GEX Candles / Key Levels are a different
// thing and they stay — see src/board/catalog.tsx. This list, App.tsx's routes
// and ALL_PAGES/LIVE_ROUTES in pages/TradersDashboard.tsx move together.
export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: '🏠' },
  {
    to: '/traders-dashboard',
    label: 'Traders Dash',
    icon: '📊',
    prefetch: ['/api/traders-dashboard/overview'],
  },
  { to: '/premarket', label: 'Premarket', icon: '🌅', prefetch: ['/api/scanner/market-quality'] },
  { to: '/options-chain', label: 'Options Chain', icon: '⛓️', prefetch: ['/api/expirations?ticker=SPX'] },
  // Prefetches the default chip's levels row on hover — the page's own lookup
  // reads it back out of the api.ts cache, so the click lands on data that is
  // already home. See src/pages/em/emData.ts (LEVELS_STALE_MS).
  { to: '/em', label: 'Est. Moves', icon: '↔️', prefetch: ['/api/levels?ticker=SPX'] },
  { to: '/analytics', label: 'Analysis', icon: '📈', prefetch: ['/api/premarket-summary'] },
  // Prefetches the recorder's symbol list on hover — the first thing every one
  // of the four tabs needs, whichever one you land on.
  { to: '/replay', label: 'Replay', icon: '⏱️', prefetch: ['/proxy/strike-growth/replay-meta'] },
  { to: '/flow', label: 'Flow', icon: '🌊' },
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
            <span className="max-w-full truncate text-3xs font-semibold leading-tight">{item.label}</span>
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
  // THE ticker control for the whole board. Every card that can follow a symbol
  // follows this one, which is why no card carries its own dropdown — see
  // src/data/symbol.tsx for which cards can and which cannot.
  //
  // It used to be a bare text box beside a read-only pill: two slots, and
  // between them they could not answer "what CAN I put in here?". You had to
  // already know a symbol to change the board, and there was nowhere to keep
  // the handful you actually watch. So the box and the pill are one control
  // now — the TickerPicker primitive, which was written for this job and had
  // been sitting unused:
  //
  //   · the trigger IS the readout (its label defaults to the active ticker),
  //     so the board's symbol still reads at a glance from the same corner;
  //   · opening it lists the whole scanner universe, fetched from the server on
  //     FIRST OPEN so no page load pays for a menu nobody opened;
  //   · typing filters it, and Enter takes the first row;
  //   · ★ pins a ticker, and pinned ones sort to the top of every open, in
  //     every page, persisted per browser.
  //
  // PAGE_TICKER_RE goes in as `allowCustom` so the one thing the old box could
  // do that a closed list cannot — jump to a symbol that is not on the server's
  // watchlist — still works: type it and take the "USE" row.
  const { symbol, setSymbol } = usePageSymbol()
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg px-3">
      <span className="text-sm font-semibold tracking-tight">CB Edge</span>
      <div className="flex-1" />
      {/* ── Back to SPX in one click ───────────────────────────────────────────
          SPX is not just the most-used ticker, it is the only one the socket
          streams: on it the GEX cards are live and free, and off it they fall
          back to a REST chain poll (see data/symbol.tsx). So leaving a symbol
          is a thing you do to look at something, and coming back is a thing you
          do constantly — two clicks and a scan of the list for the one row that
          is always in it.

          A Chip rather than a row in the picker: the picker's own list is
          alphabetical-under-the-stars and this has to be in the same place
          every time. It lights up when SPX is already the board's symbol, so it
          doubles as "am I on the live feed or the poll?" — which is the other
          question people were opening the dropdown to answer. */}
      <Chip
        label={SOCKET_SYMBOL}
        on={isSocketSymbol(symbol)}
        onClick={() => setSymbol(SOCKET_SYMBOL)}
        title="Put the whole board back on SPX — the one symbol the live socket streams, where every GEX card is on the feed rather than a chain poll"
      />
      <TickerPicker
        activeTicker={symbol}
        onSelect={setSymbol}
        allowCustom={PAGE_TICKER_RE}
        title="The board's symbol — every card that can follow a ticker is showing this one. Click to search the list or star a ticker to keep it on top."
      />
      <EtClock />
      {/* The account dropdown — same rows as v2's UserMenu, on v3 tokens. The
          Owner entry inside is owner-gated (chrome only; middleware.ts is the
          real gate). See shell/UserMenu.tsx. */}
      <UserMenu />
    </header>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  // Two providers, both above the toolbar AND the page:
  //   PageSymbolProvider — the search sets the symbol and the cards read it,
  //     and they have to be looking at one value.
  //   AuthProvider — one /api/auth/me read for the whole session. The account
  //     menu needs it, and so does anything that draws owner-only chrome.
  return (
    <AuthProvider>
      <PageSymbolProvider>
        <div className="cb-viewport flex overflow-hidden bg-bg text-fg">
          <Rail />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Toolbar />
            {children}
          </div>
        </div>
      </PageSymbolProvider>
    </AuthProvider>
  )
}
