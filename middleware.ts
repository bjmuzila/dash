import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes: landing, auth pages, the waitlist API, the maintenance page,
// and static/proxy assets. Everything else (the paid dashboard) requires a
// signed-in user.
const isPublicRoute = createRouteMatcher([
  "/",
  "/coming-soon",
  "/explore(.*)",
  "/pricing",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/waitlist(.*)",
  "/api/unsubscribe(.*)",
  "/unsubscribe",
  "/api/stripe/webhook",
  "/maintenance",
  "/terms",
  "/risk-disclosure",
  "/privacy",
  "/disclaimer",
  // Metadata routes must be public so link-preview scrapers (Discord, X,
  // Slack, iMessage) and favicon requests aren't redirected to sign-in.
  "/opengraph-image(.*)",
  "/twitter-image(.*)",
  "/icon(.*)",
  "/apple-icon(.*)",
  "/favicon.ico",
]);

// Owner Clerk user ID that bypasses maintenance mode. Set OWNER_USER_ID in env.
// Trimmed so a stray space in the env value can't cause a mismatch (lockout).
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

// Owner-only pages: the dev/admin dashboards and the personal/budget tools.
// Any signed-in non-owner hitting these is redirected to /home. Page-level
// data is already owner-gated at the API, but the pages themselves rendered
// for any signed-in user (e.g. the test account) — this locks the routes too.
const isOwnerRoute = createRouteMatcher([
  "/dev(.*)",
  "/admin(.*)",
  "/budget(.*)",
  "/personal(.*)",
]);

// Origin for the in-process proxy that holds the maintenance flag. Defaults to
// the same host the request came in on (works on Render and locally).
function proxyOrigin(req: Request): string {
  try { return new URL(req.url).origin; } catch { return ""; }
}

// Lightly cached read of the proxy maintenance flag so we don't fetch on every
// request. Stale-while-revalidate: a fresh-enough value is returned instantly;
// a stale value is ALSO returned instantly while a single background refresh
// runs. This means at most the very first request after boot waits on the
// proxy round-trip — every subsequent request reads cache and never blocks,
// removing the maintenance fetch from the critical path on normal page loads.
let maintCache: { value: boolean; at: number } = { value: false, at: 0 };
let maintRefreshing = false;
const MAINT_TTL_MS = 30000;        // serve cached value without refresh for 30s
const MAINT_HARD_MS = 5 * 60_000;  // beyond this, block once to get a real value

function refreshMaintenance(req: Request): Promise<void> {
  if (maintRefreshing) return Promise.resolve();
  maintRefreshing = true;
  return fetch(`${proxyOrigin(req)}/proxy/maintenance`, { cache: "no-store" })
    .then(async (r) => {
      if (r.ok) {
        const j = await r.json();
        maintCache = { value: !!j?.maintenance, at: Date.now() };
      }
    })
    .catch(() => { /* proxy unreachable → keep last known value (fail open) */ })
    .finally(() => { maintRefreshing = false; });
}

async function isMaintenanceOn(req: Request): Promise<boolean> {
  const age = Date.now() - maintCache.at;
  // Fresh enough → return immediately, no network.
  if (age < MAINT_TTL_MS) return maintCache.value;
  // Stale but not ancient → return the last value NOW and refresh in the
  // background (don't await), so this request isn't blocked by the round-trip.
  if (age < MAINT_HARD_MS) {
    void refreshMaintenance(req);
    return maintCache.value;
  }
  // Never fetched, or cache is very old → block once to get an authoritative value.
  await refreshMaintenance(req);
  return maintCache.value;
}

export default clerkMiddleware(async (auth, req) => {
  // Internal server-to-server calls (the in-process levels auto-publisher and
  // other localhost jobs) carry a shared-secret header instead of a Clerk
  // session. Without this they were redirected to "/" and got the landing-page
  // HTML back, breaking the publisher ("Unexpected token '<'"). The secret is
  // never exposed to the browser, so these endpoints stay non-public.
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const hasInternalToken =
    !!internalToken && req.headers.get("x-internal-token") === internalToken;
  if (hasInternalToken) return NextResponse.next();

  // ── Maintenance gate ──────────────────────────────────────────────────────
  // When ON, everyone except the owner is sent to /maintenance. Runs before the
  // public-route check so customers on the landing page see it too. The
  // /maintenance page itself and auth pages are exempt to avoid redirect loops.
  const path = req.nextUrl.pathname;
  const exemptFromMaint =
    path === "/maintenance" ||
    path === "/coming-soon" ||
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up") ||
    path.startsWith("/api/waitlist") ||
    path.startsWith("/api/unsubscribe") ||
    path === "/unsubscribe" ||
    path === "/api/stripe/webhook" ||
    path === "/terms" ||
    path === "/risk-disclosure" ||
    path === "/privacy" ||
    path === "/disclaimer";
  if (!exemptFromMaint && (await isMaintenanceOn(req))) {
    const { userId } = await auth();
    // Owner bypasses. If OWNER_USER_ID isn't configured yet, fall back to letting
    // ANY signed-in user through (so you can't accidentally lock yourself out
    // before setting the env var) — only signed-out visitors get the page.
    const isOwner = OWNER_USER_ID ? (userId || "").trim() === OWNER_USER_ID : !!userId;
    if (!isOwner) {
      const url = req.nextUrl.clone();
      url.pathname = "/maintenance";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (isPublicRoute(req)) return;

  const { userId } = await auth();

  // Signed-out users hitting a protected page get sent to the landing page
  // (the front door, which hosts the sign-in + waitlist), not Clerk's hosted UI.
  if (!userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ── Owner-only route gate ───────────────────────────────────────────────────
  // If OWNER_USER_ID is configured, only the owner may reach /dev, /budget, and
  // /personal. Everyone else (signed-in test/customer accounts) is bounced to
  // /home. If OWNER_USER_ID isn't set yet, allow any signed-in user through so
  // the owner can't lock themselves out before configuring the env var.
  if (OWNER_USER_ID && isOwnerRoute(req) && userId.trim() !== OWNER_USER_ID) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next internals, the proxy/ws backend, and static files unless in search params.
    "/((?!_next|proxy|ws|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api)(.*)",
  ],
};
