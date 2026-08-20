"use client";

import { useAuth } from "@/components/auth/AuthProvider";

/**
 * The canonical client-side owner check. FAILS CLOSED.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several components used to inline this:
 *
 *     const ownerId = process.env.NEXT_PUBLIC_OWNER_USER_ID;
 *     const isOwner = ownerId ? user?.id === ownerId : !!isSignedIn;   // <- BUG
 *
 * `NEXT_PUBLIC_OWNER_USER_ID` is only a Docker build ARG, so it is missing from
 * any build where the ARG wasn't passed. In that case the `: !!isSignedIn`
 * fallback promoted EVERY signed-in paying customer to "owner" — which is how
 * the Owner hub link and the Discord share buttons ended up rendering on
 * customer accounts. The fallback was there so the owner wouldn't be locked out
 * of his own nav before the env var was configured; it is no longer needed,
 * because `isOwnerClaim` is server truth (`users.is_owner`, delivered by
 * /api/auth/me) and is always populated.
 *
 * So: the claim, OR an explicit id match when the env var IS present. Never a
 * bare "is signed in". An unconfigured build now hides owner UI from everyone
 * rather than showing it to everyone.
 *
 * This is a COSMETIC gate. Real enforcement stays server-side: middleware.ts
 * blocks /owner/*, and owner APIs go through lib/auth/ownerApiGate.
 */
export function useIsOwner(): boolean {
  const { user, isOwnerClaim } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  return isOwnerClaim || (!!ownerId && user?.id === ownerId);
}

export default useIsOwner;
