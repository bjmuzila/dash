import { NextResponse, type NextRequest } from "next/server";
import { getUserFromMiddleware } from "@/lib/supabase/middleware";

// Public routes: landing, auth pages, the waitlist API, the maintenance page,
// and static/proxy assets. Everything else (the paid dashboard) requires a
// signed-in user.
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/coming-soon$/,
  /^\/explore(\/.*)?$/,
  /^\/pricing$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/auth\/callback$/,
  /^\/api\/waitlist(\/.*)?$/,
  /^\/api\/unsubscribe(\/.*)?$/,
  /^\/unsubscribe$/,
  /^\/api\/stripe\/webhook$/,
  /^\/maintenance$/,
  /^\/terms$/,
  /^\/risk-disclosure$/,
  /^\/privacy$/,
  /^\/disclaimer$/,
  // Metadata routes must be public so link-preview scrapers (Discord, X,
  // Slack, iMessage) and favicon requests aren't redirected to sign-in.
  /^\/opengraph-image(\/.*)?/,
  /^\/twitter-image(\/.*)?/,
  /^\/icon(\/.*)?/,
  /^\/apple-icon(\/.*)?/,
  /^\/favicon\.ico$/,
];
const isPublicRoute = (path: string) => PUBLIC_PATTERNS.some((re) => re.test(path));

// Owner-only pages: the dev/admin dashboards and the personal/budget tools.
const OWNER_PATTERNS: RegExp[] = [
  /^\/dev(\/.*)?$/,
  /^\/admin(\/.*)?$/,
  /^\/budget(\/.*)?$/,
  /^\/personal(\/.*)?$/,
];
const isOwnerRoute = (path: string) => OWNER_PATTERNS.some((re) => re.test(path));

// Owner Supabase user UUID that bypasses maintenance + reaches owner routes.
// Set OWNER_USER_ID in env to the Supabase auth.users.id of the owner account.
// Trimmed so a stray space in the env value can't cause a mismatch (lockout).
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

function proxyOrigin(req: Request): string {
  try { return new URL(req.url).origin; } catch { return ""; }
}

// ── Maintenance flag cache (unchanged from the Clerk version) ────────────────
let maintCache: { value: boolean; at: number } = { value: false, at: 0 };
let maintRefreshing = false;
const MAINT_TTL_MS = 30000;
const MAINT_HARD_MS = 5 * 60_000;

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
  if (age < MAINT_TTL_MS) return maintCache.value;
  if (age < MAINT_HARD_MS) {
    void refreshMaintenance(req);
    return maintCache.value;
  }
  await refreshMaintenance(req);
  return maintCache.value;
}

export async function middleware(req: NextRequest) {
  // Internal server-to-server calls carry a shared-secret header instead of a
  // session. Without this they were redirected to "/" and got landing HTML back.
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const hasInternalToken =
    !!internalToken && req.headers.get("x-internal-token") === internalToken;
  if (hasInternalToken) return NextResponse.next();

  const path = req.nextUrl.pathname;

  // Resolve the Supabase session ONCE. `res` carries any refreshed-session
  // cookies and must be the object we return on the pass-through paths.
  const { res, userId, isOwner: ownerClaim } = await getUserFromMiddleware(req);

  // Owner = the JWT `is_owner` claim (from the custom access-token hook) OR,
  // as a fallback while the hook is being rolled out, the env id match.
  const ownerById = OWNER_USER_ID ? (userId || "").trim() === OWNER_USER_ID : false;
  const isOwner = ownerClaim || ownerById;

  // ── Maintenance gate ───────────────────────────────────────────────────────
  const exemptFromMaint =
    path === "/maintenance" ||
    path === "/coming-soon" ||
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up") ||
    path.startsWith("/auth/callback") ||
    path.startsWith("/api/waitlist") ||
    path.startsWith("/api/unsubscribe") ||
    path === "/unsubscribe" ||
    path === "/api/stripe/webhook" ||
    path === "/terms" ||
    path === "/risk-disclosure" ||
    path === "/privacy" ||
    path === "/disclaimer";
  if (!exemptFromMaint && (await isMaintenanceOn(req))) {
    // During maintenance, owners pass; if no owner is configured, any signed-in
    // user passes (preserves prior fail-safe behavior).
    const maintOwnerOk = OWNER_USER_ID ? isOwner : !!userId;
    if (!maintOwnerOk) {
      const url = req.nextUrl.clone();
      url.pathname = "/maintenance";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (isPublicRoute(path)) return res;

  // Signed-out users hitting a protected page get sent to the landing page.
  if (!userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ── Owner-only route gate ────────────────────────────────────────────────────
  if (OWNER_USER_ID && isOwnerRoute(path) && !isOwner) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next|proxy|ws|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api)(.*)",
  ],
};
