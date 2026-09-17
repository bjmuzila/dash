import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useIsPhone } from '@/design/useIsPhone'
import { DESKTOP_TO_MOBILE, isDesktopForced, isMobilePath } from './mobileNav'

// ─────────────────────────────────────────────────────────────────────────────
// Phones land on the phone build.
//
// Mounted ONCE, inside the router and above the Shell. Three rules, all of them
// v2's (components/mobile/MobileRedirect.tsx) because the two builds have to
// behave the same way on the same handset:
//
//   1. Only routes in DESKTOP_TO_MOBILE redirect. A desktop page with no phone
//      counterpart keeps rendering its desktop layout — a cramped real page
//      beats a redirect to an unrelated one.
//   2. Desktop browsers are NEVER redirected away from /m/*, so the phone build
//      can be opened and tested on a laptop by typing the URL.
//   3. `replace`, not `push`. A redirect in the history stack means Back lands
//      on the desktop route, which immediately redirects again — the classic
//      trapped-Back-button bug.
//
// The opt-out (long-press a tab) is sessionStorage, so it lasts exactly as long
// as the tab does. See mobileNav.ts.
// ─────────────────────────────────────────────────────────────────────────────

export function MobileRedirect() {
  const phone = useIsPhone()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()

  useEffect(() => {
    if (!phone) return
    if (isDesktopForced()) return
    if (isMobilePath(pathname)) return
    const target = DESKTOP_TO_MOBILE[pathname]
    if (!target) return
    // The query string carries real state on some routes (/em?ticker=…), so it
    // rides along rather than being dropped on the way across.
    navigate(`${target}${search}`, { replace: true })
  }, [phone, pathname, search, navigate])

  return null
}

export default MobileRedirect
