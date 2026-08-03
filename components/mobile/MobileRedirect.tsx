"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DESKTOP_TO_MOBILE, isDesktopForced, isMobilePath, isPhoneViewport, normalizeMobilePath } from "./mobileNav";

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
 */
export default function MobileRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const here = normalizeMobilePath(pathname);
    if (isMobilePath(here)) return;
    if (isDesktopForced()) return;
    if (!isPhoneViewport()) return;
    const target = DESKTOP_TO_MOBILE[here];
    if (!target || target === here) return;
    router.replace(target);
  }, [pathname, router]);

  return null;
}
