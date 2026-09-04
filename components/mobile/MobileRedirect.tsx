"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DESKTOP_TO_MOBILE,
  isDesktopForced,
  isMobilePath,
  isPhoneViewport,
  isStayV2,
  normalizeMobilePath,
  v3TargetFor,
} from "./mobileNav";

/**
 * MobileRedirect — sends phones to the phone build of a page.
 *
 * Mounted once inside the router (not per page), renders nothing. On mount and
 * on every route change it asks three questions:
 *
 *   1. Is this actually a phone? Width alone is not enough — a narrow desktop
 *      window would get hijacked — so `isPhoneViewport` requires a narrow
 *      viewport AND a coarse pointer / no hover.
 *   2. Has the user opted out this session? Long-pressing the tab bar sets a
 *      sessionStorage flag; after that the redirect is off until they close the
 *      tab. Without an escape hatch a phone user could never reach a page that
 *      has no mobile build but is reachable from a desktop route.
 *   3. Does this route even HAVE a mobile counterpart? Only the routes listed
 *      in DESKTOP_TO_MOBILE redirect. Scanner, Flow, ICT and the rest keep
 *      rendering their desktop layout — a cramped real page beats being
 *      silently teleported to an unrelated one.
 *
 * The redirect is `replace`, not `push`, so the phone's back button doesn't
 * bounce between the desktop URL and the mobile one.
 *
 * Deliberately one-directional: a desktop browser opening /m/gex is left alone.
 * That is how the phone pages get tested and demoed on a laptop, and there is
 * no harm in a wide screen showing the narrow layout.
 *
 * ── THE v3 CROSSING (2026-09-04) ────────────────────────────────────────────
 * v2's phone build was showing again on phones. v3 has had its own since
 * 2026-08 and is no longer owner-gated (middleware.ts dropped that pattern when
 * the phone build shipped), so a phone on /m/* is there because of a stale
 * link, a home-screen shortcut or a bookmark — not a choice. Every /m/* route
 * now crosses to its v3 counterpart; the map, and why two of the seven do not
 * map to a v3 TAB, is in `MOBILE_TO_V3` in mobileNav.ts.
 *
 * THREE THINGS ABOUT THAT CROSSING:
 *
 *   - It is a REAL NAVIGATION, not `router.replace`. /app/* and /v3/* are two
 *     separately built Vite apps behind two different Next handlers, and this
 *     router's basename is "/app" — a push to "/v3/m/gex" would resolve to
 *     "/app/v3/m/gex", hit the SPA catch-all and land on /traders-dashboard.
 *     `location.replace`, so the stale URL leaves the history stack instead of
 *     sitting one back-press away.
 *   - It runs BEFORE the desktop→mobile hop and folds that hop in:
 *     `v3TargetFor` resolves a v2 DESKTOP path through DESKTOP_TO_MOBILE
 *     itself, so a phone landing on /es-candles goes straight to /v3/m/spx
 *     instead of rendering v2's /m/es for a frame on the way.
 *   - It is gated on the SAME phone test as everything else here, so a laptop
 *     on /app/m/es still gets v2's page. That is now the only way to look at
 *     the v2 phone build, and it is needed for as long as that build exists.
 *
 * `?v2=1` (sticky for the session) opts out on a phone too — for a bug report
 * against v2, or to compare the two.
 */
export default function MobileRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const here = normalizeMobilePath(pathname);
    if (isDesktopForced()) return;
    if (!isPhoneViewport()) return;

    // ── v3 first. Covers /m/* AND the v2 desktop routes that map into it, so
    //    the crossing costs one navigation rather than two.
    if (!isStayV2()) {
      const v3 = v3TargetFor(here);
      if (v3 && typeof window !== "undefined") {
        window.location.replace(v3 + window.location.search + window.location.hash);
        return;
      }
    }

    // ── v2's own desktop → phone hop, for anything the v3 map does not cover
    //    and for the ?v2=1 opt-out.
    if (isMobilePath(here)) return;
    const target = DESKTOP_TO_MOBILE[here];
    if (!target || target === here) return;
    router.replace(target);
  }, [pathname, router]);

  return null;
}
