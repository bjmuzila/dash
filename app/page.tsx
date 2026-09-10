import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerUserId } from "@/lib/supabase/server";
import LandingClient from "@/components/landing/LandingClient";

export const dynamic = "force-dynamic";

// The landing page's own description + canonical. Without these it inherited
// the root layout's tagline, and Google had no canonical for "/".
const TITLE = "CB Edge — Real-Time SPX GEX, Options Flow & Key Levels";
const DESC =
  "Live SPX gamma flip, Core, call and put walls computed off the options chain every 15 seconds — " +
  "shown free, no account. Every level auto-graded in public, hits and misses. $50/mo, cancel anytime.";
// Nested metadata objects REPLACE the root layout's, they do not merge — so
// openGraph is spelled out in full here (siteName included).
export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/" },
  openGraph: { siteName: "CB Edge", title: TITLE, description: DESC, url: "/", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

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

// Public landing page. Signed-in users skip straight to the dashboard, and as of
// 2026-09-06 that dashboard is v3 on BOTH form factors — the desktop board at
// `/v3`, the phone build at `/v3/m/gex`. It used to be `/traders-dashboard`,
// which is v2's board via next.config.js's alias; that route now redirects into
// v3 anyway (lib/v3Routes.ts), so sending people there was one wasted hop and a
// v2 shell flashing on the way past.
//
// Straight to `/v3/m/gex` rather than `/v3` on a phone: the SPA's own
// MobileRedirect would get there anyway, but only after the desktop board had
// mounted, which is a frame of the wrong layout and a board's worth of chunks
// nobody asked for.
//
// UNPAID signed-in users are not special-cased here. `/v3` is a normal paid
// route, so middleware.ts's paid gate catches them one hop later and sends them
// to `/home`, which is where the delayed-data dashboard lives. Repeating that
// rule here would be a second copy of the paywall to keep in sync.
//
// Signed-OUT phone visitors still get LandingClient. That page is the sales
// page; sending a prospect into an app they have not bought is not a shortcut.
export default async function RootPage() {
  const userId = await getServerUserId();
  if (userId) {
    const ua = (await headers()).get("user-agent") ?? "";
    redirect(PHONE_UA.test(ua) ? "/v3/m/gex" : "/v3");
  }
  return <LandingClient />;
}
