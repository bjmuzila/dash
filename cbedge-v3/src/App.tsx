import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from '@/shell/Shell'
import Home from '@/pages/Home'

// ─────────────────────────────────────────────────────────────────────────────
// Routing.
//
// Two rules carried over from v2's scars:
//
//  1. Every route is lazy() EXCEPT the landing route. A route that is in the
//     entry chunk is a route every user downloads whether they visit it or not.
//
//  2. There is NO silent catch-all redirect to a default page. v2 fell through
//     to /traders-dashboard whenever a route was missing, which meant a page
//     that was never registered looked like it "sort of worked" instead of
//     failing loudly. Unknown routes render NotFound. Keep it that way.
// ─────────────────────────────────────────────────────────────────────────────

const PerfOverlay = import.meta.env.DEV ? lazy(() => import('@/dev/PerfOverlay')) : null

export default function App() {
  return (
    <BrowserRouter basename="/v3">
      <Shell>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            {/* Adding a route takes FOUR edits, not two:
                  1. this line
                  2. a NAV entry in src/shell/Shell.tsx
                  3. the page itself in src/pages/
                  4. app/v3/<name>/route.ts in the v2 repo (serveSpaShell)
                Miss #4 and the page works in-app but 404s on a hard refresh. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Shell>
      {PerfOverlay && (
        <Suspense fallback={null}>
          <PerfOverlay />
        </Suspense>
      )}
    </BrowserRouter>
  )
}

function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm">
      <span className="text-lg text-fg">No such page</span>
      <span className="tabular text-faint">{pathname}</span>
    </div>
  )
}
