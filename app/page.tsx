import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "@/lib/supabase/server";
import LandingClient from "@/components/landing/LandingClient";
import MergerClient from "@/components/landing/MergerClient";
import { SALES_CLOSED } from "@/lib/salesClosed";

export const dynamic = "force-dynamic";

// The landing page's own description + canonical. Without these it inherited
// the root layout's tagline, and Google had no canonical for "/".
//
// TWO SETS, picked by SALES_CLOSED (lib/salesClosed.ts). The sales copy below
// promises a $50/mo membership that cannot be bought while the flag is on, and
// that is the string Google and every link preview show — so it has to move
// with the page, not stay behind as the site's own description of itself.
const TITLE = SALES_CLOSED
  ? "CB Edge has merged with Voltick"
  : "CB Edge — Real-Time SPX GEX, Options Flow & Key Levels";

const DESC = SALES_CLOSED
  ? "CB Edge is joining Voltick. New memberships are closed; the platform stays up and every current member keeps full access to the end of their paid term. Members sign in as usual."
  : "Live SPX gamma flip, Core, call and put walls computed off the options chain every 15 seconds — " +
    "shown free, no account. Every level auto-graded in public, hits and misses. $50/mo, cancel anytime.";

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
// THE SIGNED-IN REDIRECT IS UNCHANGED BY THE MERGER. A member who is still in
// term must land on their dashboard, not on an announcement about a product
// they are in the middle of using. `/v3` is a normal paid route, so the paid
// gate in middleware.ts catches an OUT-OF-TERM member one hop later and sends
// them to `/home` — which is the correct destination for them and the reason
// this function does not special-case them here.
//
// Signed-OUT visitors get the merger notice while sales are closed
// (lib/salesClosed.ts), and LandingClient — the sales page — when they are not.
// LandingClient is deliberately still imported and still built: reopening sales
// is one env var, and a deleted sales page would make that flag a lie.
// ── SIGNED IN BUT NOT PAYING, WHILE SALES ARE CLOSED (2026-09-22) ─────────────
// Brandon: "everyone but paid or comped users should be redirected to the home
// page if they sign in." Before this, an unpaid sign-in went / → /v3 → (paid gate)
// → /home → /pricing, and landed on a page selling a membership nobody can buy.
//
// So "/" only forwards a signed-in visitor who HAS access. Access is read from the
// SESSION (getServerSession → getSessionWithUser), which is the same truth the
// middleware paid gate uses: a live Stripe subscription OR a live comp_access
// grant, plus the owner. NOT lib/subscription.ts getAccess(), which reads the
// subscriptions table alone and cannot see a comp · a comped member would have been
// shown the merger notice instead of their dashboard.
//
// Everyone else who is signed in gets the merger notice, same as a visitor. This
// is also the LOOP GUARD for app/home/page.tsx, which now sends unpaid sign-ins
// HERE: if "/" still forwarded them to /v3, the paid gate would bounce them to
// /home and /home straight back to "/", forever.
//
// With sales OPEN the old path is kept exactly: unpaid → /v3 → /home → /pricing,
// because there is something to buy. SALES_CLOSED is the one switch for that.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export default async function RootPage() {
  const session = await getServerSession();
  if (session) {
    const hasAccess =
      session.isPaid ||
      session.isOwner ||
      (OWNER_USER_ID !== "" && session.userId === OWNER_USER_ID);
    if (hasAccess || !SALES_CLOSED) {
      const ua = (await headers()).get("user-agent") ?? "";
      redirect(PHONE_UA.test(ua) ? "/v3/m/gex" : "/v3");
    }
  }
  return SALES_CLOSED ? <MergerClient /> : <LandingClient />;
}
