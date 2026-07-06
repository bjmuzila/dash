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
  const res = NextResponse.next({ request: req });
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await validateSessionToken(token);
  return {
    res,
    userId: session?.userId ?? null,
    isOwner: !!session?.isOwner,
    isPaid: !!session?.isPaid,
  };
}
