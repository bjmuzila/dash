"use client";

/**
 * useIsOwner — the client-side owner check, in one place.
 *
 * Same rule GlobalToolbar, UserMenu and GexDock each spelled out inline: trust
 * the session's `is_owner` claim, and also accept a straight id match against
 * NEXT_PUBLIC_OWNER_USER_ID so the owner can't be locked out of their own tools
 * before the claim is wired up on an account.
 *
 * This is CHROME ONLY — it decides what gets drawn, not what is allowed. Owner
 * ROUTES are hard-blocked by middleware and components/shared/ownerGuard.tsx
 * server-side; anything genuinely sensitive must be gated there too, because a
 * hidden client tab is one devtools poke away from being visible.
 *
 * `loaded` is false until /api/auth/me answers. Render owner-only chrome on
 * `isOwner` alone (false while loading) so nothing flashes for a non-owner;
 * use `loaded` when you need to tell "not the owner" apart from "don't know
 * yet" — e.g. before bouncing someone off an owner-only tab.
 */

import { useAuth } from "@/components/auth/AuthProvider";

export function useIsOwner(): { isOwner: boolean; loaded: boolean } {
  const { user, isOwnerClaim, isLoaded } = useAuth();
  const ownerId = (process.env.NEXT_PUBLIC_OWNER_USER_ID || "").trim();
  return {
    isOwner: isOwnerClaim || (!!ownerId && !!user?.id && user.id === ownerId),
    loaded: isLoaded,
  };
}

export default useIsOwner;
