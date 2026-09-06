import { NextResponse, type NextRequest } from "next/server";
import { getUserFromMiddleware } from "@/lib/supabase/middleware";
import {
  BARE_SOURCE_LIST,
  CUSTOM_SLUG_RE,
  resolvePlacement,
  shortLinkLocation,
} from "@/lib/shortLinks";
import { lookupShortLink } from "@/lib/shortLinkRegistry";
import { PROMO_SLUG_LIST } from "@/lib/promoLinks";
import { v3TargetForAppPath } from "@/lib/v3Routes";

/**
 * The one-segment short links (`/x`, `/youtube`, …), built from the SAME list
 * the route handler answers for. Written out by hand this would be a public
 * pattern that drifts from the router — a link that 302s but is gated, or is
 * public but 404s, is the same bug twice.
 *
 * It MUST stay an explicit alternation of known sources. `^\/[a-z0-9-]+$` would
 * make every single-segment path public, which is every gated dashboard page on
 * the site (`/es-candles`, `/scanner`, `/owner`).
 */
const BARE_SHORT_LINK_RE = new RegExp(`^\\/(${BARE_SOURCE_LIST.join("|")})$`);

/**
 * Promo short links (`/bday`, …) — same shape, same rule: derived from the
 * PROMO_LINKS table in lib/promoLinks.ts so the route that answers and the
 * gate that lets it through can never drift apart. Adding a promo there makes
 * its link public here automatically.
 */
const PROMO_LINK_RE = new RegExp(`^\\/(${PROMO_SLUG_LIST.join("|")})$`);

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
  // Customer changelog (app/whats-new/page.tsx, reads CUSTOMER_CHANGELOG.md).
  // Public on purpose: "we ship every week" is a selling point, so a signed-out
  // visitor — or anyone following a link from X/Discord — must land on the real
  // page instead of being 307'd to "/". The page renders correctly with no
  // session: getServerUserId() returns null, isOwner is false, and the hidden
  // bullet list is withheld, so a guest sees exactly what a paying customer
  // sees and nothing more. Anchored (no /.* suffix) — there are no subroutes.
  /^\/whats-new$/,
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
  // Landing-page data, read by signed-OUT visitors: /api/public-stats (graded
  // percentages), /api/public-ledger (the rows behind them) and
  // /api/public-levels (the free SPX level tile). All three are registered
  // auth:'public' in server-v2/api-router.js, which intercepts /api/* before
  // middleware runs in production — this entry is what keeps them reachable if
  // the API_ROUTER kill-switch is ever flipped off. Without it a signed-out
  // visitor gets a 307 to "/" and the landing page renders an empty hero.
  /^\/api\/public-[a-z-]+$/,

  /^\/api\/unsubscribe(\/.*)?$/,
  /^\/unsubscribe$/,
  // Short campaign links — /x/click, /youtube/video, /hackernews/click. They
  // are 302 redirectors handled by app/[source]/[action]/route.ts and are
  // linked from public posts, so they must resolve signed OUT; the destination
  // they forward to is gated on its own terms. The verb suffix is what keeps
  // this pattern from accidentally opening a real two-segment route.
  /^\/[a-z0-9-]+\/(click|profile|bio|post|video|link)$/,
  // …and the one-segment form of the same thing (`/x`), handled by
  // app/[source]/route.ts. No verb to disambiguate it, so this is an explicit
  // allowlist of known sources — see BARE_SHORT_LINK_RE above.
  BARE_SHORT_LINK_RE,
  // Promo deal links (`/bday`) — 302 redirectors into /pricing, put on
  // graphics and posts, so they must resolve signed OUT. See PROMO_LINK_RE.
  PROMO_LINK_RE,
  /^\/api\/stripe\/webhook$/,
  // Page-load beacon. Public because it fires on EVERY load including guests
  // and unpaid users — gating it silently drops visit logging for exactly the
  // traffic the visitor map exists to show. It writes nothing a caller controls
  // beyond the page key, and resolves the session itself when one is present.
  // (In production server-v2/api-router.js intercepts this path before
  // middleware runs; this entry is what keeps the fallback path correct if the
  // API_ROUTER kill-switch is ever flipped off.)
  /^\/api\/page-status$/,
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
  // Standalone Vite "home 3.0" dashboard (public/home3) — owner-only while it's
  // a partial recreation, so paying customers keep the complete /home. Static
  // assets (/home3/assets/*.js, *.css, *.png) bypass this gate via the matcher
  // extension exclusion below; only the bare /home3 entry route is gated.
  /^\/home3$/,
  // Dashboard v3 (public/v3, built from cbedge-v3/) USED TO BE HERE, owner-only
  // for the same reason /home3 is. It came off on 2026-09-03, when the phone
  // build (/v3/m/*) shipped: v3 is now a normal paid route — signed-out
  // visitors still go to "/", unpaid ones still go to /home, and paying
  // customers reach it. Nothing else about the gate changed; there is no
  // v3-shaped hole in it, only one fewer owner-only pattern.
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

  // ── Owner-created short links — cbedge.net/<name> ──────────────────────────
  //
  // The static ones (`/x`, `/bday`) are PUBLIC_PATTERNS above, because their
  // names are known at build time. These aren't: they're rows in short_links
  // that the owner adds from the Overview panel, so the gate can't be a regex
  // baked into this file — it's a cached table lookup (lib/shortLinkRegistry).
  //
  // It ANSWERS here rather than just marking the path public and letting
  // app/[source]/route.ts do it. That is the whole safety argument: middleware
  // runs before routing, so if a row ever names a real page the visible result
  // is that page redirecting — loud, and obvious the moment you load it —
  // instead of a gated page quietly becoming reachable signed-out. (Reserved
  // names are rejected at both write and read, so this is the third net, not
  // the first.) The registry answers from memory, so the bot traffic that
  // pounds one-segment paths never reaches Postgres.
  //
  // Same 302 + no-store as app/[source]/route.ts, for the same reason: a 301
  // would be cached by every proxy in between and re-pointing the link later
  // would never reach anyone who had clicked it once.
  if (CUSTOM_SLUG_RE.test(path.slice(1))) {
    const slug = path.slice(1);
    const link = await lookupShortLink(slug);
    if (link) {
      const sp = req.nextUrl.searchParams;
      const placement = {
        ...resolvePlacement(slug, "click"),
        medium: link.medium || "referral",
        campaign: link.campaign || "link",
      };
      const location = shortLinkLocation(placement, sp.get("c"), sp.get("to") ?? link.dest);
      const out = NextResponse.redirect(new URL(location, req.nextUrl.origin), 302);
      out.headers.set("Cache-Control", "no-store, max-age=0");
      return out;
    }
  }

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
  // reachable, plus /home and /mult-greek for unpaid-but-signed-in users. /home and
  // /mult-greek both render in "delayed" mode for them (see their page.tsx —
  // reads a frozen *_static_snapshots row instead of the live feed, no live
  // WS/chain loop), so on-the-fence signups land on the real dashboard with
  // real (delayed) data instead of a hard paywall. Everything else still
  // redirects to /home.
  const PAID_EXEMPT = /^\/(pricing|home|mult-greek|api\/stripe|api\/home-snapshot|api\/mult-greek-snapshot)(\/.*)?$/;
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

  // ── v2 → v3 ────────────────────────────────────────────────────────────────
  // v3 is THE dashboard. A v2 route that v3 fully answers redirects into v3, so
  // /app/* survives only as the surfaces v3 has not built — which is exactly
  // what /v3/legacy links to. Table + rationale: lib/v3Routes.ts.
  //
  // AFTER the paid gate on purpose: an unpaid user hitting /app/scanner should
  // land on /home in ONE hop, not bounce through /v3/scanner to get there.
  //
  // This catches the DOCUMENT request — a bookmark, a pasted link, a hard
  // refresh, and the bare /scanner-style aliases in next.config.js (redirects()
  // runs before middleware, so /scanner -> /app/scanner -> here). An in-SPA
  // click never reaches the server, so app-vite/src/V3Redirect.tsx does the same
  // job on the client from the same table.
  //
  // 307, never 308 — see the note at the top of lib/v3Routes.ts. url.search is
  // carried untouched, which is what keeps /app/scanner?tab=ibstats and
  // /app/level-log?ticker=SPX shareable across the move.
  const v3Target = v3TargetForAppPath(path);
  if (v3Target) {
    const url = req.nextUrl.clone();
    url.pathname = v3Target;
    return NextResponse.redirect(url, 307);
  }

  // bfcache hardening: authed PAGES must not be restored from the browser
  // back/forward cache without re-running these gates. Forces a fresh request
  // (and thus this middleware) on Back after checkout/sign-out.
  //
  // Scoped to documents. This used to be unconditional, which meant every
  // /api/* response got `no-store` stamped over whatever Cache-Control the route
  // had computed — so lib/cacheHeaders.ts, the CACHE_30 presets and the
  // `s-maxage=1800` on the slow-moving endpoints were all dead code behind the
  // paywall, and the browser re-fetched /api/calendar, /api/expirations,
  // /api/levels & co. from scratch on every single navigation. A data response
  // was never in the bfcache to begin with; only the document is.
  //
  // sec-fetch-dest is sent by every browser that implements bfcache, so the
  // fallback below only catches non-browser clients — where the header's absence
  // plus a non-/api path still means "treat it as a document".
  const dest = req.headers.get("sec-fetch-dest");
  const isDocument = dest
    ? dest === "document" || dest === "iframe" || dest === "frame"
    : !path.startsWith("/api/");
  if (isDocument) {
    res.headers.set("Cache-Control", "no-store, must-revalidate");
  }
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
