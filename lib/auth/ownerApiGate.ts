import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";

/**
 * Owner-or-internal gate for Next API route handlers.
 *
 * Why this exists as a shared helper rather than another copy of the local
 * `ownerGate()` in app/api/reta/route.ts: the routes that need it are also
 * called by in-process schedulers (server-v2/condor-mark-recorder.js,
 * em-tracker-auto-eval.js) over loopback with NO session cookie — only the
 * shared secret. A session-only gate would 403 every automated write and the
 * failure would be silent, so the token check has to come FIRST, exactly as
 * server-v2/api-router.js:126-133 does it.
 *
 * Note middleware.ts:128-131 already short-circuits on the same header, but a
 * `NextResponse.next()` there just means the request reaches this handler
 * un-gated — the token still has to be re-checked here or the automated
 * callers hit the owner branch below and fail.
 *
 * Fails CLOSED: with OWNER_USER_ID unset nobody passes. That is deliberate and
 * differs from components/shared/ownerGuard.tsx, which falls back to "any
 * signed-in user" so the owner can't lock themselves out of a PAGE. These are
 * data-mutating endpoints; the safe failure mode is the opposite one. Same
 * posture as app/api/reta/route.ts and app/api/budget/route.ts.
 */

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const INTERNAL_API_TOKEN = (process.env.INTERNAL_API_TOKEN || "").trim();

export type OwnerGate = { ok: true } | { ok: false; status: 401 | 403 };

export async function ownerOrInternal(req: Request): Promise<OwnerGate> {
  const tok = req.headers.get("x-internal-token");
  if (INTERNAL_API_TOKEN && tok === INTERNAL_API_TOKEN) return { ok: true };

  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

/** Uniform denial body. 401 = no session at all, 403 = signed in, not owner. */
export function gateDenied(gate: { ok: false; status: 401 | 403 }) {
  return NextResponse.json(
    { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
    { status: gate.status },
  );
}
