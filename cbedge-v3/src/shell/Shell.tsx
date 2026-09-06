import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { preload } from '@/data/api'
import { isMobilePath } from '@/mobile/mobileNav'
import { AuthProvider, useAuth } from '@/data/auth'
import { PAGE_TICKER_RE, PageSymbolProvider, SOCKET_SYMBOL, isSocketSymbol, usePageSymbol } from '@/data/symbol'
import { Chip } from '@/design/primitives/Controls'
import { ExpandStageHost } from '@/design/primitives/Expand'
import { ReplayDockHost } from '@/design/primitives/ReplayDock'
import { TickerPicker } from '@/design/primitives/TickerPicker'
import { useIsPhone } from '@/design/useIsPhone'
import { CbMark, CbWordmark } from '@/shell/Brand'
import { CopyShotMenu, CopyShotProvider } from '@/shell/CopyShot'
import { NotesPanelProvider, useNotesPanel } from '@/shell/NotesPanelContext'
import { OfferPill } from '@/shell/OfferPill'
import { ToolbarSlotHost, ToolbarSlotProvider } from '@/shell/ToolbarSlot'
import { UserMenu } from '@/shell/UserMenu'
import { UpdateToast } from '@/shell/UpdateToast'

/**
 * The notes dock, its note store and the owner's Quick Probe are ~30KB of source
 * that only matters once someone opens the panel, and this file is the ENTRY
 * chunk — budgets.json caps it at 37KB brotli with 15% slack, so a static import
 * here would spend the headroom of the whole app on a drawer most sessions never
 * open. lazy() puts the three of them in their own chunk, fetched on the first
 * click of ✎ and cached from then on.
 */
const NotesDock = lazy(() => import('@/shell/NotesDock'))

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
// Scanner, Test Lab and Journal (built, then retired) and Multi Greek, Board,
// ES Candles and ICT (never more than a dimmed "coming soon" icon). v3 is not
// shipping those pages, and an icon for a page nobody is going to build is the
// same lie `comingSoon` exists to avoid.
//
// SCANNER CAME BACK 2026-09-02 — ported properly this time, against the
// 1,525-row checklist in docs/parity/scanner.md rather than rebuilt from a
// description. Test Lab and Journal are still out.
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
  // Next to Est. Moves on purpose — both are pre-open prep, read once before the
  // bell rather than watched. No prefetch: the page's three feeds go out through
  // a raw fetch(…, { cache: 'no-store' }) in data/econCalendar.ts, not through
  // api.ts, so a warmed api cache would never be read back — an unused request
  // on every hover. Give it one the day that hook moves onto api.ts.
  { to: '/economic-calendar', label: 'Econ Cal', icon: '📅' },
  { to: '/analytics', label: 'Analysis', icon: '📈', prefetch: ['/api/premarket-summary'] },
  // Prefetches the recorder's symbol list on hover — the first thing every one
  // of the four tabs needs, whichever one you land on.
  { to: '/replay', label: 'Replay', icon: '⏱️', prefetch: ['/proxy/strike-growth/replay-meta'] },
  { to: '/flow', label: 'Flow', icon: '🌊' },
  // Prefetches the default tab's first feed on hover. /scanner opens on GEX
  // Change Top (Brandon, 2026-09-02 — v2 had two disagreeing answers for this
  // and DEFAULT_TAB in pages/scanner/scannerNav.ts is now the only one), so the
  // click lands on data that is already home.
  { to: '/scanner', label: 'Scanner', icon: '🔭', prefetch: ['/proxy/gex-change-top'] },
  // Landed 2026-09-03 with the wall-migration chart — the first surface of v2's
  // /app/level-log to come across. No prefetch: the page's fetch is keyed on a
  // ticker AND a date, and warming SPX-on-today would be wrong for anyone whose
  // last link named something else.
  { to: '/level-log', label: 'Level Log', icon: '🧱' },
  // Last in the rail on purpose — it is the way OUT of v3, not a place to work.
  // Lists the v2 pages that have no v3 route and links to each one at /app/*.
  // It is the honest version of the dimmed "coming soon" icons that came out of
  // this list on 2026-08-30: those said a page was coming, this says where the
  // page actually is today. Shrinks as v3 fills in; delete it when it is empty.
  { to: '/legacy', label: 'v2 Legacy', icon: '🗄️' },
]

// The rail head. It was a drawn accent square with the letters "CB" in it —
// a placeholder from before the artwork existed. It is the real badge now:
// CbMark, the one square form of the brand (see shell/Brand.tsx). Sized on one
// axis because the asset is square by construction.
function Logo() {
  return <CbMark className="mb-2 h-8 w-8 shrink-0" title="CB Edge" />
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

// ─────────────────────────────────────────────────────────────────────────────
// ✎ NOTES — the toolbar's handle on the right-hand dock.
//
// The dock (shell/NotesDock.tsx) and its open/closed state
// (shell/NotesPanelContext.tsx) were ported weeks ago and then had NOTHING
// mounting them: no provider, no button, so the panel and the Quick Probe
// inside it were unreachable in v3. This button is the missing half.
//
// WHAT IS IN THE PANEL. The notes list for everyone signed in, and — for the
// owner only — the QUICK PROBE card at the top of it: ticker / expiry / strike /
// C-or-P straight onto the owner probe list, no navigation (shell/QuickProbe.tsx
// has the endpoint contract). The probe is drawn owner-only and the write is
// gated owner-only server side, so this one button is safe to show to any
// signed-in user; they simply get notes and no probe.
//
// NO NOTE COUNT ON THE BUTTON, and that is a budget decision rather than a
// design one: the count would mean a `useNotes` instance here, and useNotes
// lives in shell/notes.tsx alongside NotesBody — pulling ~15KB of note editor
// into the ENTRY chunk to render one number. The panel is one click away and
// carries its own count in its header.
//
// The pencil is drawn inline for the same reason: importing PencilIcon would
// drag the same module in behind it.
//
// DESKTOP ONLY, on the same test the dock uses — a 320px drawer on a 390px
// phone is the screen with a margin, and a button that opens nothing is worse
// than no button.
// ─────────────────────────────────────────────────────────────────────────────
function NotesButton() {
  const { isSignedIn } = useAuth()
  const { open, togglePanel } = useNotesPanel()
  const isPhone = useIsPhone()

  if (!isSignedIn || isPhone) return null

  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-pressed={open}
      aria-label="Notes"
      title={
        open
          ? 'Close the notes panel'
          : 'Notes — jot, clip and keep; the Quick Probe lives at the top of it'
      }
      className={[
        'flex shrink-0 items-center rounded-sm border border-line px-2 py-1 leading-none transition-colors',
        open ? 'bg-raised text-fg' : 'text-muted hover:text-fg',
      ].join(' ')}
    >
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  )
}

/**
 * Mounts the dock the first time it is opened and leaves it mounted. `everOpen`
 * rather than `open` so closing it does not unmount the panel and throw away the
 * Quick Probe's half-typed contract.
 */
function NotesDockSlot() {
  const { open } = useNotesPanel()
  const [everOpen, setEverOpen] = useState(false)
  useEffect(() => {
    if (open) setEverOpen(true)
  }, [open])
  if (!everOpen) return null
  return (
    <Suspense fallback={null}>
      <NotesDock />
    </Suspense>
  )
}

function Toolbar({ mobile = false }: { mobile?: boolean }) {
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
      {/* The wordmark, not the words. "CB Edge" set in the UI font was a
          stand-in; the horizontal lockup is the brand in a wide slot, and the
          toolbar is the wide slot it was drawn for. See shell/Brand.tsx. */}
      <CbWordmark className="h-6 w-auto shrink-0" />
      <div className="flex-1" />
      {/* ── THE PAGE'S OWN CONTROLS ────────────────────────────────────────────
          Empty on every route that puts nothing in it. The home board fills it
          with Edit layout / Save layout / + Add card, which is why that page no
          longer draws a header row of its own. See shell/ToolbarSlot.tsx. */}
      <ToolbarSlotHost />
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
      {/* ── NOT ON THE PHONE BUILD (2026-09-03) ────────────────────────────
          These two set the BOARD's symbol, and on /m/* nothing reads it: the
          GEX chart, the Multi Greek ladder and the candles are each pinned to
          SPX for now (see the `simple` / `pinnedFirst` / `spxOnly` props on
          those cards). A picker that moves a value no visible card follows is
          a control that lies, which is the one thing this toolbar was rebuilt
          to stop being. Everything else here — the mark, the clock, the camera,
          the account menu — is the same bar the desktop draws, which is the
          point: the phone is v3, not a second app.

          When a phone screen follows a ticker again, delete the guard. */}
      {!mobile && (
        <>
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
        </>
      )}
      {/* ── The live offer ($30 first month) ───────────────────────────────────
          Draws NOTHING unless this account has an unredeemed, unexpired
          lifecycle offer, and does not even ask for signed-out or currently
          paying accounts — which is nearly everyone.

          A dropdown rather than a modal on purpose: the offer is attached to
          the account and /api/stripe/checkout pre-applies it, so there is
          nothing the user has to do. Blocking the board to announce a price
          they already have is an interruption dressed up as a favour. It is
          also the only surface that reaches the people whose offer email
          bounced or got filtered. See shell/OfferPill.tsx. */}
      <OfferPill />
      <EtClock />
      {/* ── 📸 ─────────────────────────────────────────────────────────────────
          The one camera in the app. Draws nothing for anyone but the owner, and
          nothing at all until some surface on the current page has published
          itself as worth photographing — see shell/CopyShot.tsx. */}
      <CopyShotMenu />
      {/* ── ✎ ──────────────────────────────────────────────────────────────────
          Opens the notes dock on the right, which is also where the owner's
          Quick Probe lives. See NotesButton above. */}
      <NotesButton />
      {/* The account dropdown — same rows as v2's UserMenu, on v3 tokens. The
          Owner entry inside is owner-gated (chrome only; middleware.ts is the
          real gate). See shell/UserMenu.tsx. */}
      <UserMenu />
    </header>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  // ── /m/* keeps the TOOLBAR and drops the RAIL ───────────────────────────────
  // The rail is 64px of a 390px screen — a quarter of it, spent on a nav the
  // bottom tab bar already is. The toolbar stays, and it is the SAME component
  // the desktop draws: brand, ET clock, camera, account menu, one instance, one
  // set of behaviours. A phone-only copy of that bar would be a second thing to
  // change every time (`mobile` there hides only the board's ticker controls —
  // see the note beside them).
  //
  // The three providers below stay exactly where they are either way, which is
  // the whole reason this is a branch inside Shell rather than a second shell
  // component: the socket, the store, the page symbol and the auth read are one
  // instance for the session, and a phone that mounted its own would open a
  // second WebSocket the moment someone long-pressed back to the desktop.
  const mobile = isMobilePath(useLocation().pathname)

  // Three providers, all above the toolbar AND the page:
  //   PageSymbolProvider — the search sets the symbol and the cards read it,
  //     and they have to be looking at one value.
  //   AuthProvider — one /api/auth/me read for the whole session. The account
  //     menu needs it, and so does anything that draws owner-only chrome.
  //   CopyShotProvider — the camera lives in the toolbar and its targets are
  //     published by the page, so the registry has to sit above both.
  //   ToolbarSlotProvider — same shape, same reason: the slot is IN the toolbar
  //     and its contents come FROM the page, so it has to be above both.
  //   NotesPanelProvider — the ✎ button that toggles the dock is in the toolbar
  //     and the dock itself is a sibling of the page column, so the open/closed
  //     flag has to sit above the two of them. (It also persists per browser
  //     under v2's OWN storage key, so a dock left open in /app/* is open here —
  //     same person, same browser, same panel. See NotesPanelContext.tsx.)
  return (
    <AuthProvider>
      <PageSymbolProvider>
        <CopyShotProvider>
          <ToolbarSlotProvider>
          <NotesPanelProvider>
          {/* "New version — Update". Fixed-position, so it is a sibling of the
              layout rather than part of it, and mounted once for both branches.
              See data/appVersion.ts for why an open phone tab needs telling. */}
          <UpdateToast />
          {mobile ? (
            <div className="cb-viewport flex flex-col overflow-hidden bg-bg text-fg">
              <Toolbar mobile />
              <ReplayDockHost>{children}</ReplayDockHost>
            </div>
          ) : (
          <div className="cb-viewport flex overflow-hidden bg-bg text-fg">
            <Rail />
            {/* THE PAGE COLUMN. Toolbar, page, and — whenever a surface is
                rewound — the replay dock as the last child. The dock is in FLOW,
                so it shrinks the page instead of covering the bottom of it; see
                design/primitives/ReplayDock.tsx. Every replay transport in the
                app lands there, which is why the announcement that you are
                looking at a recording is the whole bottom edge of the screen
                rather than a chip somewhere inside a panel. */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Toolbar />
              {/* ── ExpandStageHost — DO NOT DROP THIS WRAPPER ────────────────
                  It is what makes every Card's expand control exist: outside a
                  stage the context is null and Card draws no button at all, so
                  removing this line does not break loudly, it silently deletes
                  the feature from the whole app. (It has been lost to a Shell
                  rewrite once already — 2026-09-03.)

                  It sits INSIDE the page column and OUTSIDE the page, which is
                  what makes a card's "full screen" fill exactly this box —
                  everything right of the rail and below the toolbar — instead
                  of covering the viewport. Both stay live and clickable while a
                  card is expanded, which is how you leave it. Inside
                  ReplayDockHost, so the dock still holds the bottom edge under
                  an expanded card rather than being covered by it.
                  See design/primitives/Expand.tsx. ── */}
              <ReplayDockHost>
                <ExpandStageHost>{children}</ExpandStageHost>
              </ReplayDockHost>
            </div>
            {/* ── THE NOTES DOCK ───────────────────────────────────────────────
                A flex SIBLING of the page column, exactly like the rail on the
                other side: open it and the page gets narrower, it does not get
                covered. Closed it is 0px wide and draws nothing at all.

                Outside the page column on purpose — inside it, the dock would
                be underneath the toolbar and an expanded card would cover it,
                and "open my notes while looking at this card" is most of what
                it is for. It renders null for a signed-out visitor and on a
                phone, so both branches of this layout stay honest.

                MOUNTED ONLY ONCE OPENED. lazy() means the chunk is not fetched
                until this renders, and the dock is 0px wide while closed — so
                gating on `open` costs nothing visible and keeps the fetch on
                the click that needs it. It stays mounted after that, which is
                what keeps the width transition (and the probe's typed-in
                fields) alive across a close and reopen. */}
            <NotesDockSlot />
          </div>
          )}
          </NotesPanelProvider>
          </ToolbarSlotProvider>
        </CopyShotProvider>
      </PageSymbolProvider>
    </AuthProvider>
  )
}
