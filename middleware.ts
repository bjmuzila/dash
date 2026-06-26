import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes: landing, auth pages, the waitlist API, the maintenance page,
// and static/proxy assets. Everything else (the paid dashboard) requires a
// signed-in user.
const isPublicRoute = createRouteMatcher([
  "/",
  "/explore(.*)",
  "/pricing",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/waitlist(.*)",
  "/api/stripe/webhook",
  "/maintenance",
  "/terms",
  "/risk-disclosure",
  "/privacy",
  "/disclaimer",
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
  "/budget(.*)",
  "/personal(.*)",
]);

// Origin for the in-process proxy that holds the maintenance flag. Defaults to
// the same host the request came in on (works on Render and locally).
function proxyOrigin(req: Request): string {
  try { return new URL(req.url).origin; } catch { return ""; }
}

// Lightly cached read of the proxy maintenance flag so we don't fetch on every
// request. Cache TTL keeps the toggle near-instant without hammering the proxy.
let maintCache: { value: boolean; at: number } = { value: false, at: 0 };
const MAINT_TTL_MS = 5000;

async function isMaintenanceOn(req: Request): Promise<boolean> {
  if (Date.now() - maintCache.at < MAINT_TTL_MS) return maintCache.value;
  try {
    const r = await fetch(`${proxyOrigin(req)}/proxy/maintenance`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      maintCache = { value: !!j?.maintenance, at: Date.now() };
      return maintCache.value;
    }
  } catch { /* proxy unreachable → fail open (no maintenance) */ }
  maintCache = { value: false, at: Date.now() };
  return false;
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
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up") ||
    path.startsWith("/api/waitlist") ||
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
