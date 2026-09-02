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

// Every page below is lazy() — see rule 1 above. The chunk names fall out of
// the file names, which is what makes an over-budget route legible in
// check-budgets.mjs output.
const TradersDashboard = lazy(() => import('@/pages/TradersDashboard'))
const Premarket = lazy(() => import('@/pages/Premarket'))
const OptionsChain = lazy(() => import('@/pages/OptionsChain'))
const Analysis = lazy(() => import('@/pages/Analysis'))
const Flow = lazy(() => import('@/pages/Flow'))
// /em — Estimated Moves. A 1:1 port of v2's /app/em against the checklist in
// docs/parity/em.md; REST-only, opens no socket, mounts no canvas.
const Em = lazy(() => import('@/pages/Em'))
// /replay — the replay hub. Four tabs, each mounting a surface that already
// exists elsewhere, opened ALREADY REWOUND. Spec: docs/parity/replay.md. Its own
// chunk is small on purpose: three of the four tabs lazy() into the SAME chunks
// /options-chain and /analytics already load.
const Replay = lazy(() => import('@/pages/Replay'))

// /scanner — seven tabs over one route. UN-RETIRED 2026-09-02: the page was
// removed from v3 on 2026-08-30 and is back as a 1:1 port against the checklist
// in docs/parity/scanner.md (1,525 rows). The tab lives in the query string, so
// /v3/scanner?tab=ibstats is a shareable link — which is also why
// app/v3/scanner/route.ts had to stop answering 404. Each of the seven tabs is
// its own lazy() chunk INSIDE that route: v2 static-imported all seven, so
// 329KB of tab components shipped to everyone whichever tab they opened.
const Scanner = lazy(() => import('@/pages/Scanner'))

// STILL RETIRED 2026-08-30 — Test Lab (/test) and Journal (/trading) are gone
// from v3, along with the ICT, ES Candles, Board and Multi Greek rail slots
// (they never had pages here, only "coming soon" icons). The BOARD CARDS of the
// same names — Multi Greek, GEX Candles, Key Levels — are deliberately
// untouched: see src/board/catalog.tsx. Pages out, cards in.

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
            {/* Paths match v2's /app/* routes exactly, so a bookmark, a doc
                link or a habit transfers by swapping one path segment. */}
            <Route path="/traders-dashboard" element={<TradersDashboard />} />
            <Route path="/premarket" element={<Premarket />} />
            <Route path="/options-chain" element={<OptionsChain />} />
            <Route path="/analytics" element={<Analysis />} />
            <Route path="/flow" element={<Flow />} />
            <Route path="/em" element={<Em />} />
            <Route path="/replay" element={<Replay />} />
            <Route path="/scanner" element={<Scanner />} />
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
