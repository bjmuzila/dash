import { useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { MOBILE_TABS, MOBILE_TO_DESKTOP, setDesktopForced } from './mobileNav'

// ─────────────────────────────────────────────────────────────────────────────
// The bottom tab bar.
//
// Six destinations, fixed to the bottom edge, safe-area aware. It is drawn ONCE
// per page (MobileShell renders it) rather than by the app shell, because a
// `fill` page has to know the bar's height to take the exact remaining space —
// having the bar inside the same flex column is what makes that arithmetic
// unnecessary.
//
// LONG-PRESS = DESKTOP SITE. There is no room for a seventh item and no
// appetite for a menu, so the escape hatch is a gesture: hold any tab for ~550ms
// and the phone build stands down for the session (sessionStorage, see
// mobileNav.ts) and you land on the desktop page that tab stands in for. A
// plain tap is unaffected — the timer is cleared on pointerup and the NavLink's
// own click still fires.
//
// Every colour here is a token class. No literal appears in this file; the
// active tint is `text-accent`, which is the same accent the desktop rail uses
// for its active item, so the two builds light up the same way.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a hold has to last before it counts as "give me the desktop". */
const LONG_PRESS_MS = 550

export function MobileTabBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const timer = useRef<number | null>(null)
  const fired = useRef(false)

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  const holdStart = (tabPath: string) => {
    fired.current = false
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      setDesktopForced(true)
      navigate(MOBILE_TO_DESKTOP[tabPath] ?? '/', { replace: true })
    }, LONG_PRESS_MS)
  }

  return (
    <nav
      aria-label="Sections"
      className="shrink-0 border-t border-line bg-rail"
      // The home indicator on a modern iPhone sits UNDER the viewport's bottom
      // edge; without this the last row of tap targets is half-covered by it.
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch justify-between px-1">
        {MOBILE_TABS.map((tab) => {
          const active = pathname === tab.path || pathname.startsWith(tab.path + '/')
          return (
            <NavLink
              key={tab.id}
              to={tab.path}
              title={`${tab.title} — hold for the desktop page`}
              onPointerDown={() => holdStart(tab.path)}
              onPointerUp={clear}
              onPointerLeave={clear}
              onPointerCancel={clear}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => {
                // The hold already navigated. Swallow the click the same
                // pointer sequence is about to produce, or we would land on the
                // desktop page and immediately be pulled back to the tab.
                if (fired.current) {
                  e.preventDefault()
                  fired.current = false
                }
              }}
              className={[
                // 52px of height plus the safe-area pad clears the 44px tap
                // target floor with room for the label under the glyph.
                'flex min-h-[52px] flex-1 select-none flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1',
                active ? 'text-accent' : 'text-muted opacity-60',
              ].join(' ')}
              style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
            >
              <span aria-hidden className="text-base leading-none">
                {tab.icon}
              </span>
              <span className="max-w-full truncate text-3xs font-semibold leading-tight">{tab.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

export default MobileTabBar
