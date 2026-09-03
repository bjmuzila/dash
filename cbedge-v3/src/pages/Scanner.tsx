// ─────────────────────────────────────────────────────────────────────────────
// /scanner — the scanner page. Six tabs over one route.
//
// (Seven until 2026-09-03, when TPO Structures was dropped. See the dated note
// in `pages/scanner/scannerNav.ts` — the registry is where a tab exists or
// stops existing; this file only mounts what the registry's union allows, which
// is why `TAB_COMPONENT` is a `Record<ScannerTabId, …>` and not a partial map.)
//
// Ported from v2's `components/pages/Scanner.tsx` against the checklist in
// docs/parity/scanner.md Part A. This file is the FRAME only: tab state, the
// owner gate, and the six mount points. Every value on screen belongs to a
// tab component, and every threshold behind those values belongs to a module
// under `@/pages/scanner/`.
//
// Four things here are not obvious from the screen:
//
//   1. THE TAB IS IN THE URL. v2 kept it in `useState` and never wrote `?tab=`
//      back, so a tab could not be shared by copying the address bar and
//      back/forward did not move between tabs. Here `useSearchParams` is the
//      source of truth. `/v3/scanner?tab=ibstats` is pasteable, which matters
//      for the same reason `app/v3/em/route.ts` gives for its own existence: a
//      shared link IS a hard refresh.
//   2. EVERY TAB IS `lazy()`. v2 static-imported all seven of its tabs, so 329KB
//      of tab components plus a 3,100-line page shipped to every visitor
//      whichever tab they opened. One chunk per tab means an over-budget tab is
//      legible in check-budgets.mjs by name, which is the whole reason the
//      budgets file names chunks at all.
//   3. THE OWNER GATE IS THREE-WAY, NOT TWO. While auth resolves,
//      `visibleTab` is null and NOTHING mounts — not the gated tab, not the
//      fallback. A flash of the wrong tab that then swaps is worse than an
//      empty beat, and it would also fire the wrong tab's requests. This is v2's
//      behaviour and it is deliberate; see `useIsOwner`'s `loaded` flag.
//   4. THE GATE IS CHROME. It decides what is drawn, not what is allowed. A
//      hidden tab is one devtools poke away from visible, so anything behind it
//      that must not leak needs a server-side gate on its own data route. Pick
//      Study's five routes are only PROVEN gated on the two POSTs — see the
//      note in `pickStudyData.ts`.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// The `SCANNER_TAB_EVENT` window event is gone. v2 needed it because its strip
// navigated to `/scanner?tab=…` and React Router does not remount for a
// query-string-only change — so the URL moved and the visible tab did not. With
// the tab IN the query string, `useSearchParams` observes that change directly.
// v2's listener was also the unvalidated way in: it cast any truthy `detail` to
// a tab id with no `isScannerTabId` guard, so a malformed event rendered the
// page with no card at all, silently.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `ScannerTabsBar` — not rendered by v2's page either; superseded by
//   `SectionSubStrip`, and it drags `next/link` + `next/navigation`.
// • `GreeksScanner` and `VolPinScanner` — both fully written in v2's page file
//   and reachable from no tab. The live Greeks scanner is on the owner page
//   (Brandon, 2026-09-02). `/proxy/vol-pin-scanner` does not exist in
//   `server-v2` at all — zero matches across all three server files — so the
//   Vol Pin table would 404 if anything called it.
// • `/level-log` and `/strike-history` — separate routes that only shared v2's
//   sub-strip. Not part of this page.
//
// Spec: docs/parity/scanner.md Part A, rows A1–A58.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, lazy, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Page } from '@/design/primitives/Page'
import { useIsOwner } from '@/data/auth'
import {
  DEFAULT_TAB,
  OWNER_ONLY_TABS,
  SCANNER_GROUPS,
  SCANNER_TABS,
  isScannerTabId,
  type ScannerTabId,
} from '@/pages/scanner/scannerNav'

// Six chunks, one per tab. See note 2 above — this is the fix for v2 shipping
// all of them to everyone. The chunk names fall out of the file names, which is
// what makes an over-budget tab legible in check-budgets.mjs output.
const GexLevelsTab = lazy(() => import('@/pages/scanner/GexLevelsTab'))
const GexChangeTopTab = lazy(() => import('@/pages/scanner/GexChangeTopTab'))
const PickStudyTab = lazy(() => import('@/pages/scanner/PickStudyTab'))
const StrikeQueryTab = lazy(() => import('@/pages/scanner/StrikeQueryTab'))
const IbStatsTab = lazy(() => import('@/pages/scanner/IbStatsTab'))
const WatchThisTab = lazy(() => import('@/pages/scanner/WatchThisTab'))

const TAB_COMPONENT: Record<ScannerTabId, React.LazyExoticComponent<() => React.JSX.Element>> = {
  gexlevels: GexLevelsTab,
  gexchangetop: GexChangeTopTab,
  pickstudy: PickStudyTab,
  strike: StrikeQueryTab,
  ibstats: IbStatsTab,
  watch: WatchThisTab,
}

/** The query-string key the tab lives under. One spelling. */
const TAB_PARAM = 'tab'

export default function Scanner() {
  const [params, setParams] = useSearchParams()
  const { isOwner, loaded: authLoaded } = useIsOwner()

  const raw = params.get(TAB_PARAM)
  // An unrecognised ?tab= falls back rather than rendering nothing. v2 did the
  // same on this path (`readTabFromUrl` returns null for an unknown id); the
  // difference is that v2 then had a SECOND path — the window event — that did
  // not validate at all.
  const tab: ScannerTabId = isScannerTabId(raw) ? raw : DEFAULT_TAB

  const ownerGated = OWNER_ONLY_TABS.has(tab) && !isOwner
  // Three-way, not two. Null during the auth beat: no tab mounts, so no tab's
  // fetches fire. See note 3 above.
  const visibleTab: ScannerTabId | null = ownerGated ? (authLoaded ? DEFAULT_TAB : null) : tab

  const selectTab = useCallback(
    (id: ScannerTabId) => {
      // `replace` so the six tabs do not stack six entries in the history
      // for one visit — back should leave the page, not walk the tabs you
      // browsed. The URL still updates, which is the point of the departure.
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(TAB_PARAM, id)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const Tab = visibleTab ? TAB_COMPONENT[visibleTab] : null

  return (
    <Page>
      <TabStrip active={visibleTab} isOwner={isOwner} onSelect={selectTab} />
      {/* `key` on the boundary so switching tabs gets a fresh Suspense rather
          than holding the previous tab's tree while the next chunk loads. */}
      <Suspense key={visibleTab ?? 'pending'} fallback={null}>
        {Tab ? <Tab /> : null}
      </Suspense>
    </Page>
  )
}

// ── The tab strip ────────────────────────────────────────────────────────────
// Plain on purpose: step 3 is completeness, not styling. It renders the three
// clusters `SCANNER_GROUPS` defines, in order, with a hairline between them —
// that grouping is a product decision recorded in the registry, not decoration.
//
// Owner-only pills are dropped for everyone else, matching v2's bar and strip.
// This is the same chrome-level filter as the page gate; neither is a boundary.

function TabStrip({
  active,
  isOwner,
  onSelect,
}: {
  active: ScannerTabId | null
  isOwner: boolean
  onSelect: (id: ScannerTabId) => void
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-line pb-2">
      {SCANNER_GROUPS.map((group, gi) => {
        const tabs = group.tabs
          .map((id) => SCANNER_TABS.find((t) => t.id === id))
          .filter((t): t is (typeof SCANNER_TABS)[number] => !!t && (!t.ownerOnly || isOwner))
        if (tabs.length === 0) return null
        return (
          <div key={group.key} className="flex items-center gap-1">
            {gi > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-line" />}
            {tabs.map((t) => {
              const on = t.id === active
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t.id)}
                  aria-current={on ? 'page' : undefined}
                  title={t.label}
                  className={[
                    'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm',
                    on ? 'border-line bg-surface2 text-fg' : 'border-transparent text-muted',
                  ].join(' ')}
                  // The accent is per-tab and comes from the registry as a
                  // token. Only the active pill wears it, so the row does not
                  // become six competing colours.
                  style={on ? { borderColor: t.accent } : undefined}
                >
                  <span aria-hidden>{t.icon}</span>
                  <span>{t.short}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
