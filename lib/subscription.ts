// Server-side subscription gating. Import in API routes / server components to
// decide whether a Clerk user may access the paid product.

import { getServerUserId } from "@/lib/supabase/server";
import { getSubscription, PAID_STATUSES } from "@/lib/db";

// The owner always has access regardless of billing state.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export interface AccessResult {
  ok: boolean;
  reason: "owner" | "subscribed" | "unauthenticated" | "no-subscription" | "inactive";
  status?: string | null;
}

/** True if a stored subscription row currently grants access. */
export function isPaid(status: string | null | undefined): boolean {
  return !!status && PAID_STATUSES.has(status);
}

/** Resolve access for an explicit Clerk user id (no request context needed). */
export async function getAccessForUser(userId: string): Promise<AccessResult> {
  if (OWNER_USER_ID && userId === OWNER_USER_ID) return { ok: true, reason: "owner" };
  const sub = await getSubscription(userId);
  if (!sub) return { ok: false, reason: "no-subscription" };
  if (isPaid(sub.status)) return { ok: true, reason: "subscribed", status: sub.status };
  return { ok: false, reason: "inactive", status: sub.status };
}

/** Resolve access for the current request's signed-in user. */
export async function getAccess(): Promise<AccessResult> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, reason: "unauthenticated" };
  return getAccessForUser(userId);
}

/** Convenience boolean for the current request. */
export async function hasActiveSubscription(): Promise<boolean> {
  return (await getAccess()).ok;
}
