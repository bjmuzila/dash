import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from '@/shell/Shell'
import { MobileRedirect } from '@/mobile/MobileRedirect'
import { MOBILE_DEFAULT_PATH } from '@/mobile/mobileNav'
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

// /economic-calendar — two tabs over one feed: timed econ events with earnings
// woven into the day, and a five-column earnings week board. A 1:1 port of
// v2's /app/economic-calendar against the 176-row checklist in
// docs/parity/economic-calendar.md. REST-only: three feeds fired in parallel at
// entry, no socket, no canvas. The tab lives in the query string, so
// /v3/economic-calendar?tab=earnings is a shareable link.
const EconomicCalendar = lazy(() => import('@/pages/EconomicCalendar'))

// /level-log — v2's /app/level-log, being ported a surface at a time against
// the 283-row checklist in docs/parity/level-log.md. What is here is the WALL
// MIGRATION chart (Part H) and the range switch that made v2's popout worth
// opening (Part I); the ticker rail, the log card, the capture rail, the churn
// strip and the timeline are still v2-only. The ticker and the date live in the
// query string, so /v3/level-log?ticker=SPX&date=2026-09-02 is a shareable link
// — which is why app/v3/level-log/route.ts had to be added with it.
const LevelLog = lazy(() => import('@/pages/LevelLog'))

// /legacy — the v2 door. One page listing every v2 destination v3 has no route
// for, each one a real <a href="/app/…"> out of the SPA. v2 and v3 run side by
// side with no cutover day, which means a surface that only exists in v2 is
// invisible from inside v3 unless something says where it went. Static list, no
// fetch, no socket. Delete an entry there the day its v3 route lands.
const Legacy = lazy(() => import('@/pages/Legacy'))

// ── THE PHONE BUILD — /v3/m/* ────────────────────────────────────────────────
// Six screens, registered in src/mobile/mobileNav.ts, each one a HOME-BOARD CARD
// or a v3 page rendered full-bleed inside MobileShell. There is no phone-only
// implementation of any number on them: the Heat tab IS MultiGreekCard, the GEX
// tab IS GexChartCard, so a fix to a card is a fix to the phone. v2 shipped six
// bespoke phone pages under components/mobile/ and they drifted from the desktop
// inside a week — this is the same product decision made the other way.
//
// lazy() like every other route, and each one is a thin wrapper whose real
// weight is the chunk the card already has, so a phone downloads the card it is
// looking at and nothing else.
//
// A hard refresh on any of these is answered by app/v3/m/[tab]/route.ts in the
// v2 repo — ONE dynamic segment, deliberately not a catch-all under /v3, which
// would swallow /v3/assets/*.js and hand back HTML.
const MGex = lazy(() => import('@/mobile/pages/MGex'))
const MHeat = lazy(() => import('@/mobile/pages/MHeat'))
const MSpx = lazy(() => import('@/mobile/pages/MSpx'))
const MEm = lazy(() => import('@/mobile/pages/MEm'))
const MEcon = lazy(() => import('@/mobile/pages/MEcon'))

// STILL RETIRED 2026-08-30 — Test Lab (/test) and Journal (/trading) are gone
// from v3, along with the ICT, ES Candles, Board and Multi Greek rail slots
// (they never had pages here, only "coming soon" icons). The BOARD CARDS of the
// same names — Multi Greek, GEX Candles, Key Levels — are deliberately
// untouched: see src/board/catalog.tsx. Pages out, cards in.

export default function App() {
  return (
    <BrowserRouter basename="/v3">
      {/* Phones on a route that HAS a phone counterpart are replaced to it.
          Above the Shell because it needs the router and nothing else, and
          `replace` so Back does not land on the route it just left. */}
      <MobileRedirect />
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
            <Route path="/economic-calendar" element={<EconomicCalendar />} />
            <Route path="/level-log" element={<LevelLog />} />
            <Route path="/legacy" element={<Legacy />} />

            {/* ── The phone build ────────────────────────────────────────────
                Adding a tab is TWO edits: MOBILE_TABS in
                src/mobile/mobileNav.ts and a line here. The Next handler is
                already generic (app/v3/m/[tab]/route.ts). */}
            <Route path="/m" element={<Navigate to={MOBILE_DEFAULT_PATH} replace />} />
            <Route path="/m/gex" element={<MGex />} />
            <Route path="/m/heat" element={<MHeat />} />
            <Route path="/m/spx" element={<MSpx />} />
            <Route path="/m/em" element={<MEm />} />
            <Route path="/m/econ" element={<MEcon />} />

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
