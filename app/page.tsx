import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerUserId } from "@/lib/supabase/server";
import LandingClient from "@/components/landing/LandingClient";

export const dynamic = "force-dynamic";

/**
 * Is this a PHONE, as far as the server can tell?
 *
 * `Android.*Mobile` is Google's own documented phone test — an Android TABLET's
 * user agent says "Android" and omits "Mobile" — and iPadOS reports itself as
 * Macintosh, so neither a tablet nor a laptop reaches the phone build from here.
 *
 * Deliberately a user-agent test and NOT a width test. This decision is made on
 * the server, before one byte of JavaScript runs, and a viewport width is not
 * knowable there; the alternative is serving the landing page and bouncing from
 * the client, which is a visible flash of the wrong page on the slowest
 * connection anyone uses. The app's own phone test
 * (`cbedge-v3/src/design/useIsPhone.ts`) stays width + pointer, which is the
 * right test once a viewport exists — the two answer different questions and
 * are allowed to disagree at the edges. Nothing is gated on this: it picks a
 * landing spot, and every route it can send you to is reachable by typing it.
 */
const PHONE_UA = /iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|BlackBerry|Opera Mini/i;

// Public landing page. Signed-in users skip straight to the dashboard — and on
// a phone that dashboard is the v3 phone build (2026-09-03).
//
// Straight to `/v3/m/gex` rather than `/v3`: the SPA's own MobileRedirect would
// get there anyway, but only after the desktop board had mounted, which is a
// frame of the wrong layout and a board's worth of chunks nobody asked for.
//
// Signed-OUT phone visitors still get LandingClient. That page is the sales
// page; sending a prospect into an app they have not bought is not a shortcut.
export default async function RootPage() {
  const userId = await getServerUserId();
  if (userId) {
    const ua = (await headers()).get("user-agent") ?? "";
    redirect(PHONE_UA.test(ua) ? "/v3/m/gex" : "/traders-dashboard");
  }
  return <LandingClient />;
}
