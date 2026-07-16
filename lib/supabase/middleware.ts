import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validateSessionToken } from "@/lib/auth/session";

/**
 * Middleware session resolver for the custom auth system.
 *
 * Kept the same file path, export name, and return shape as the old
 * Supabase-backed version so middleware.ts (and anything else importing this)
 * didn't need to change. Unlike Supabase's getUser(), which round-trips to
 * Supabase's auth server on every call, this hits our own Postgres directly
 * (through validateSessionToken's short in-memory cache) -- no cookie
 * rewriting needed either, since our session token doesn't rotate per request.
 *
 * Requires the Node.js middleware runtime (pg needs a real TCP socket) -- see
 * `export const runtime = "nodejs"` in middleware.ts.
 */
export async function getUserFromMiddleware(req: NextRequest): Promise<{
  res: NextResponse;
  userId: string | null;
  isOwner: boolean;
  isPaid: boolean;
}> {
  // Plain pass-through — do NOT pass `{ request: req }` here. That form tells
  // Next to re-emit the request (headers AND body) to the downstream handler,
  // which consumes the body stream inside middleware. GETs are unaffected (no
  // body), so the site looks fine — but any POST carrying a body then dies in
  // the route with "TypeError: Response body object should not be disturbed or
  // locked" at fromNodeNextRequest, before a single line of handler code runs.
  // That broke every Discord snapshot upload. We modify nothing about the
  // request (no header rewrite, no cookie rotation), so the bare form is both
  // correct and sufficient.
  const res = NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateSessionToken(token);
  return {
    res,
    userId: session?.userId ?? null,
    isOwner: !!session?.isOwner,
    isPaid: !!session?.isPaid,
  };
}
