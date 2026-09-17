import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV } from '@/shell/Shell'
import { MOBILE_TABS } from '@/mobile/mobileNav'

// ─────────────────────────────────────────────────────────────────────────────
// THE v3 VISIT BEACON.
//
// v3 shipped without one. Every page_visits row in the database came from v2's
// lib/pageStatus.ts, which is a Next-side hook mounted per PAGE — so the moment
// a paid customer crossed into v3 they stopped being logged. In the 30 days to
// 2026-09-14 that was 5,254 visit rows and exactly ONE /v3/* row, and the
// consequence was not a gap in a chart: a customer who asked for a refund
// showed a "last seen" of four days earlier while he was signed in that
// morning, because his whole session was inside v3.
//
// Read `/home` in the old data with that in mind. app/home/page.tsx is a
// redirect (paid → /v3), so those rows are the moment someone ENTERED v3 and
// went dark, not a page anyone looked at.
//
// WHY THIS IS ONE HOOK AND NOT A PER-PAGE ONE.
// v2 mounted the hook inside each page because each Next page was a fresh
// document load. v3 is one document for the whole session: the Shell mounts
// once and never unmounts (see shell/Shell.tsx). A per-page hook here would
// need adding to every route and would be forgotten on the next one — the
// router already knows when the route changed, so ask it. Mounted once in
// App.tsx, inside BrowserRouter, and it covers every route including the phone
// build at /v3/m/*.
//
// SHAPE OF THE POST. Identical to v2's — same endpoint, same field names, same
// session-entry rules — because both write the same page_visits table and the
// owner map, the acquisition panel and /api/admin/customer-activity all read it
// as one stream. Divergence here shows up as a broken funnel, not a type error.
// Server side: server-v2/api-router.js `/api/page-status` (auth 'public',
// identify: true — signed-in rows carry user_id, which is the whole point).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session-entry attribution, carried over from lib/pageStatus.ts verbatim —
 * INCLUDING the storage key.
 *
 * document.referrer and ?utm_* describe how somebody ARRIVED and do not change
 * for the rest of the visit, so they are sent on the first beacon of the
 * browser session only and that row is flagged is_entry. Sessions are counted
 * as COUNT(*) WHERE is_entry.
 *
 * The key MUST stay 'cb:visit-entry', the same string v2 uses. A visitor lands
 * on the Next marketing pages, signs in, and is redirected into v3 — one visit
 * across two front ends, one tab, one sessionStorage. A key of our own would
 * flag a second entry row on the hand-off and report every arriving customer as
 * two sessions from two sources.
 */
const ENTRY_KEY = 'cb:visit-entry'
let entryClaimedInMemory = false

type EntryAttribution = { isEntry: boolean; referrer: string | null; query: string | null }

function claimSessionEntry(): EntryAttribution {
  const none: EntryAttribution = { isEntry: false, referrer: null, query: null }
  if (typeof window === 'undefined') return none
  if (entryClaimedInMemory) return none

  let alreadyClaimed = false
  try {
    alreadyClaimed = window.sessionStorage.getItem(ENTRY_KEY) === '1'
  } catch {
    /* storage blocked — the in-memory flag alone carries it */
  }
  if (alreadyClaimed) {
    entryClaimedInMemory = true
    return none
  }

  // Claimed BEFORE the network call so a fast second mount cannot also claim it.
  entryClaimedInMemory = true
  try {
    window.sessionStorage.setItem(ENTRY_KEY, '1')
  } catch {
    /* non-fatal */
  }

  return {
    isEntry: true,
    // Empty string = direct navigation (typed URL, bookmark). null, not "".
    referrer: document.referrer || null,
    query: window.location.search || null,
  }
}

/**
 * Human label for a route, so the owner visit log reads "Traders Dash" rather
 * than "/traders-dashboard".
 *
 * Sourced from the two tables that already exist rather than a third copy —
 * NAV (shell/Shell.tsx) and MOBILE_TABS (mobile/mobileNav.ts). A route added to
 * either one is labelled here the same day with no edit. A route in neither
 * (/feedback is deliberately out of the rail; /legacy moves around) falls back
 * to its own path, which is ugly in the log but never wrong.
 */
function labelFor(routePath: string): string {
  const nav = NAV.find((n) => n.to === routePath)
  if (nav) return nav.label
  const tab = MOBILE_TABS.find((t) => t.path === routePath)
  if (tab) return tab.title || tab.label
  return routePath
}

type Payload = {
  pageKey: string
  pageLabel: string
  path: string
  isLoaded: boolean
  lastLoadedAt: string
  lastUnloadedAt?: string
  isEntry: boolean
  referrer: string | null
  query: string | null
}

function post(payload: Payload): void {
  const body = JSON.stringify(payload)
  // Telemetry must never compete with the page's own data for connections or
  // main-thread time. sendBeacon is queued by the browser at the lowest
  // priority and survives the navigation that triggered it.
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon('/api/page-status', new Blob([body], { type: 'application/json' }))
      return
    } catch {
      /* fall through to fetch */
    }
  }
  void fetch('/api/page-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

/**
 * Guard against logging the same route twice in a breath.
 *
 * A `replace` navigation (MobileRedirect, the /m → default-tab hop) can land on
 * the same pathname twice inside a frame, and main.tsx renders under
 * <StrictMode>, which double-invokes effects in dev. v2's log carries the scar
 * of having neither guard: paths appear twice in the same second throughout it,
 * which inflates every load count in the owner panel roughly 2x and is why
 * "57 page loads" for one customer was really about 30. Do not remove this to
 * "see everything" — a duplicate is not a visit.
 *
 * Checked at REPORT time, not at effect time. Checking on mount would make
 * StrictMode's second pass skip the report that its first pass had already
 * cancelled, and log nothing at all in dev.
 */
const DEDUPE_MS = 1500
let lastReport: { path: string; at: number } | null = null

function shouldReport(path: string): boolean {
  const now = Date.now()
  if (lastReport && lastReport.path === path && now - lastReport.at < DEDUPE_MS) return false
  lastReport = { path, at: now }
  return true
}

/**
 * Fires one visit row per route the user actually lands on. Mount ONCE, inside
 * BrowserRouter (App.tsx). It renders nothing.
 */
export function usePageVisitBeacon(): void {
  const { pathname } = useLocation()
  // The route currently reported as loaded, so leaving it can close it out in
  // page_load_status. Held in a ref rather than derived from `pathname` because
  // the cleanup runs after the location has already changed. Null until the
  // load beacon actually went out, so a route abandoned before idle fired is
  // never "closed" either.
  const openRef = useRef<Payload | null>(null)

  useEffect(() => {
    // The router strips the "/v3" basename, so `pathname` is the route and
    // window.location.pathname is what the visitor's address bar says. STORE
    // THE LATTER: a row logged as "/traders-dashboard" is indistinguishable
    // from the v2 page of the same name, which is exactly the confusion this
    // whole beacon exists to end. Query strings are left off on purpose —
    // /scanner?tab=ibstats is the Scanner page, and folding the tab into `path`
    // would multiply distinct_pages in /api/admin/customer-activity.
    const fullPath =
      typeof window !== 'undefined' ? window.location.pathname : `/v3${pathname}`

    const loadedAt = new Date().toISOString()

    // Deferred to idle (with a timeout, so a busy page still reports promptly).
    // The session-entry claim happens HERE, not above: claiming it for a
    // beacon the dedupe then drops would burn the one is_entry row of the
    // visit and lose the referrer for the whole session.
    const report = () => {
      if (!shouldReport(fullPath)) return
      const entry = claimSessionEntry()
      const payload: Payload = {
        pageKey: `v3:${pathname}`,
        pageLabel: labelFor(pathname),
        path: fullPath,
        isLoaded: true,
        lastLoadedAt: loadedAt,
        // Acquisition — first beacon of the session only. The server must not
        // read its own Referer header instead: that points at the page firing
        // the beacon, not at where the visitor came from.
        isEntry: entry.isEntry,
        referrer: entry.referrer,
        query: entry.query,
      }
      openRef.current = payload
      post(payload)
    }
    const handle =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(report, { timeout: 3000 })
        : (setTimeout(report, 0) as unknown as number)

    // Closing a page out writes NO visit row (the server only inserts when
    // isLoaded) — it just keeps page_load_status honest about what is open.
    // isEntry is never re-sent here: a stray handler would double-count the
    // session.
    const close = () => {
      const open = openRef.current
      if (!open) return
      openRef.current = null
      post({
        ...open,
        isLoaded: false,
        lastUnloadedAt: new Date().toISOString(),
        isEntry: false,
        referrer: null,
        query: null,
      })
    }

    window.addEventListener('beforeunload', close)
    return () => {
      window.removeEventListener('beforeunload', close)
      // A route torn down before idle fired was never really loaded.
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle)
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
      close()
    }
  }, [pathname])
}

/** Mountable form, for App.tsx. Renders nothing. */
export function PageVisitBeacon(): null {
  usePageVisitBeacon()
  return null
}
