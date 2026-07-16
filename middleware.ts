import { NextResponse, type NextRequest } from "next/server";
import { getUserFromMiddleware } from "@/lib/supabase/middleware";

// Public routes: landing, auth pages, the waitlist API, the maintenance page,
// and static/proxy assets. Everything else (the paid dashboard) requires a
// signed-in user.
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/coming-soon$/,
  /^\/explore(\/.*)?$/,
  // Public marketing toolbar links Docs — the KB is end-user help, not paid
  // content, so it must resolve for signed-out visitors instead of bouncing to /.
  /^\/docs(\/.*)?$/,
  /^\/pricing$/,
  /^\/checkout\/success$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/auth\/callback$/,
  /^\/auth\/reset-password$/,
  // Enforced auth endpoints must be reachable while signed OUT (they're how you
  // sign in). They do their own Turnstile + rate-limit gating internally.
  /^\/api\/auth\/(login|signup|logout|me|forgot-password|reset-password)$/,
  // Internal automation session minter — reachable without a cookie because it
  // does its own INTERNAL_API_TOKEN gating (used by the morning budget email).
  /^\/api\/auth\/internal-session$/,
  /^\/api\/auth\/google(\/.*)?$/,
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

// Owner-only pages: everything lives under /owner/* now, so ONE pattern gates
// the whole group (plus the app/owner/layout.tsx OwnerGuard as defense-in-depth).
// New owner pages under app/owner/ need no extra gating anywhere.
const OWNER_PATTERNS: RegExp[] = [
  /^\/owner(\/.*)?$/,
  // Owner-group backend tools that live at the root (shown under the owner rail).
  /^\/social-media(\/.*)?$/,
];
const isOwnerRoute = (path: string) => OWNER_PATTERNS.some((re) => re.test(path));

// Old owner-route prefixes → new /owner/* locations. Page routes only — these
// anchored patterns never match /api/* (e.g. /api/admin/*).
const OWNER_MOVED_PREFIXES: [RegExp, string][] = [
  [/^\/dev(?=\/|$)/, "/owner/dev"],
  [/^\/admin(?=\/|$)/, "/owner/admin"],
  [/^\/budget(?=\/|$)/, "/owner/budget"],
  [/^\/personal(?=\/|$)/, "/owner/personal"],
  [/^\/market-scanner(?=\/|$)/, "/owner/market-scanner"],
];
function ownerMovedTarget(path: string): string | null {
  for (const [re, to] of OWNER_MOVED_PREFIXES) {
    if (re.test(path)) return path.replace(re, to);
  }
  return null;
}

// Owner user id that bypasses maintenance + reaches owner routes. Set
// OWNER_USER_ID in env to the owner account's users.id (see lib/db.ts).
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

  // Resolve the session ONCE (cbe_session cookie -> Postgres). `res` is just a
  // pass-through NextResponse now — no per-request cookie rewriting needed
  // since our session token doesn't rotate on every request.
  const { res, userId, isOwner: ownerFlag, isPaid } = await getUserFromMiddleware(req);

  // Owner = the users.is_owner column OR, as a fallback, the env id match.
  const ownerById = OWNER_USER_ID ? (userId || "").trim() === OWNER_USER_ID : false;
  const isOwner = ownerFlag || ownerById;

  // ── Maintenance gate ───────────────────────────────────────────────────────
  const exemptFromMaint =
    path === "/maintenance" ||
    path === "/coming-soon" ||
    path.startsWith("/sign-in") ||
    path.startsWith("/sign-up") ||
    path.startsWith("/auth/callback") ||
    path.startsWith("/auth/reset-password") ||
    path.startsWith("/api/auth/") ||
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

  // Old owner URLs (bookmarks, pinned quick-pages) → permanent new /owner/* home.
  const moved = ownerMovedTarget(path);
  if (moved) {
    const url = req.nextUrl.clone();
    url.pathname = moved;
    return NextResponse.redirect(url, 308);
  }

  // Signed-out users hitting a protected page get sent to the landing page.
  if (!userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ── Paid-subscription gate (covers EVERY protected route) ────────────────────
  // Owners always pass. Routes needed to actually buy/see pricing stay
  // reachable, plus /home, /mult-greek, and /preview (the lighter predecessor,
  // still linked from /pricing) for unpaid-but-signed-in users. /home and
  // /mult-greek both render in "delayed" mode for them (see their page.tsx —
  // reads a frozen *_static_snapshots row instead of the live feed, no live
  // WS/chain loop), so on-the-fence signups land on the real dashboard with
  // real (delayed) data instead of a hard paywall. Everything else still
  // redirects to /home.
  const PAID_EXEMPT = /^\/(pricing|preview|home|mult-greek|api\/stripe|api\/preview|api\/home-snapshot|api\/mult-greek-snapshot)(\/.*)?$/;
  if (!isOwner && !isPaid && !PAID_EXEMPT.test(path)) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
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

  // bfcache hardening: authed pages must not be restored from the browser
  // back/forward cache without re-running these gates. Forces a fresh request
  // (and thus this middleware) on Back after checkout/sign-out.
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  return res;
}

// Node.js runtime: session validation now queries Postgres directly (pg needs
// a real TCP socket), replacing Supabase's edge-compatible getUser() call.
export const runtime = "nodejs";

export const config = {
  matcher: [
    // Video/audio extensions belong here for the same reason the image ones do:
    // a <video src> on the PUBLIC landing page is fetched by the browser as a
    // plain asset request. Without an exclusion it hits the auth gate, isn't a
    // PUBLIC_PATTERN, and gets 307'd to "/" — the element then receives HTML
    // instead of video and silently falls back to its poster. The asset looks
    // "missing" while actually being deployed and gated.
    // NOTE: /api/discord-share is excluded from BOTH entries below (it would
    // otherwise match each one). Reason: this middleware runs on the Node.js
    // runtime, and Next builds the middleware's Request from the same incoming
    // Node stream the route handler later needs. For a POST carrying a body the
    // stream is consumed here, and the route then dies with "TypeError: Response
    // body object should not be disturbed or locked" at fromNodeNextRequest —
    // before one line of handler code runs. GETs have no body, so nothing else
    // on the site shows it. Skipping middleware is safe for THIS route only
    // because app/api/discord-share/route.ts does its own getServerUserId() +
    // OWNER_USER_ID gate. Do NOT copy this exclusion to a route that relies on
    // middleware for auth.
    "/((?!_next|proxy|ws|api/discord-share|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|m4v|ogg|mp3)).*)",
    "/api/((?!discord-share(?:/|$)).*)",
  ],
};
