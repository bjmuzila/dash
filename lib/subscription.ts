// Server-side subscription gating. Import in API routes / server components to
// decide whether a Clerk user may access the paid product.

import { getServerUserId } from "@/lib/supabase/server";
import { getPaidAccessRow, PAID_STATUSES } from "@/lib/db";

// The owner always has access regardless of billing state.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export interface AccessResult {
  ok: boolean;
  reason: "owner" | "subscribed" | "comped" | "unauthenticated" | "no-subscription" | "inactive";
  status?: string | null;
}

/** True if a Stripe status reads as paying. Reporting only since 2026-10-07:
 *  access is the member list (member_access), not Stripe. */
export function isPaid(status: string | null | undefined): boolean {
  return !!status && PAID_STATUSES.has(status);
}

/** Resolve access for an explicit user id (no request context needed). Same
 *  sources as is_paid in lib/db.ts getSessionWithUser(): a live member row, a
 *  live comp or a live Voltick grant. Stripe status alone no longer counts. */
export async function getAccessForUser(userId: string): Promise<AccessResult> {
  if (OWNER_USER_ID && userId === OWNER_USER_ID) return { ok: true, reason: "owner" };
  const row = await getPaidAccessRow(userId);
  if (!row) return { ok: false, reason: "no-subscription" };
  if (row.is_owner) return { ok: true, reason: "owner" };
  if (row.is_comped) return { ok: true, reason: "comped", status: row.status };
  if (row.is_member) return { ok: true, reason: "subscribed", status: row.status };
  return { ok: false, reason: row.status ? "inactive" : "no-subscription", status: row.status };
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
