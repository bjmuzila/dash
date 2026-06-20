import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes: landing, auth pages, the waitlist API, and static/proxy assets.
// Everything else (the paid dashboard) requires a signed-in user.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/waitlist(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // Internal server-to-server calls (the in-process levels auto-publisher and
  // other localhost jobs) carry a shared-secret header instead of a Clerk
  // session. Without this they were redirected to "/" and got the landing-page
  // HTML back, breaking the publisher ("Unexpected token '<'"). The secret is
  // never exposed to the browser, so these endpoints stay non-public.
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (internalToken && req.headers.get("x-internal-token") === internalToken) {
    return NextResponse.next();
  }

  const { userId } = await auth();

  // Signed-out users hitting a protected page get sent to the landing page
  // (the front door, which hosts the sign-in + waitlist), not Clerk's hosted UI.
  if (!userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
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
