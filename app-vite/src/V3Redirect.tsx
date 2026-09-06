import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { v3Href, v3TargetFor } from '@/lib/v3Routes'

// ─────────────────────────────────────────────────────────────────────────────
// V3Redirect — the CLIENT half of the v2 → v3 move.
//
// middleware.ts already redirects /app/<ported> to /v3/<ported>, but middleware
// only sees DOCUMENT requests. Once a browser is inside this SPA, React Router
// navigates on the client and no server hop happens at all — so a user who came
// in through a /v3/legacy link could click the toolbar straight back into a page
// v3 already owns, and the whole redirect would read as optional. This closes
// that, from the same table, so an in-app click and a hard refresh agree.
//
// TWO THINGS IT DELIBERATELY DOES.
//
// 1. It renders NOTHING while a redirect is pending, rather than sitting beside
//    the routes as a silent effect. A ported page is a live-feed page: mounting
//    it opens the socket, fires its entry fetches and paints a chart, all of
//    which would be thrown away one frame later. Returning null instead of
//    `children` costs a blank flash and saves a page's worth of work.
//
// 2. It leaves via `window.location.replace`, not the router. v3 is a separate
//    bundle with its own socket and its own store — crossing over is a document
//    navigation, not a route change. `replace` rather than `assign` so Back
//    lands wherever the user actually came from instead of bouncing them
//    forwards into v3 again.
//
// It must be mounted INSIDE BrowserRouter (it reads useLocation) and ABOVE
// LayoutShell (so the toolbar does not paint on a page that is leaving).
//
// WHEN THIS FILE CAN BE DELETED: when PORTED in lib/v3Routes.ts covers every
// route left in App.tsx — at which point v2 has no pages of its own and the SPA
// itself goes with it.
// ─────────────────────────────────────────────────────────────────────────────

export default function V3Redirect({ children }: { children: ReactNode }) {
  // Inside a BrowserRouter with basename="/app", pathname arrives WITHOUT the
  // basename — "/scanner", not "/app/scanner" — which is exactly the shape
  // v3TargetFor takes.
  const { pathname, search } = useLocation()
  const target = v3TargetFor(pathname)

  useEffect(() => {
    if (!target) return
    // search is carried across so /app/scanner?tab=ibstats survives the move.
    window.location.replace(v3Href(target, search))
  }, [target, search])

  return target ? null : <>{children}</>
}
