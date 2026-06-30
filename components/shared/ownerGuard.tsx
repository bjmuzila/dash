import { getServerIsOwner, getServerUserId } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

// Server-side owner gate used by owner-only route layouts (defense-in-depth on
// top of the middleware redirect). Runs at request time before any owner page
// renders. Non-owners get a 404 (notFound) rather than a redirect so the route
// doesn't even reveal that it exists.
//
// If OWNER_USER_ID isn't configured yet, fall back to allowing any signed-in
// user so the owner can't lock themselves out before setting the env var —
// signed-out users are always rejected.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export default async function OwnerGuard({ children }: { children: React.ReactNode }) {
  // Prefer the JWT `is_owner` claim; fall back to allowing any signed-in user
  // only when no owner id is configured (so the owner can't lock themselves out
  // before the env var / hook is set up).
  if (OWNER_USER_ID) {
    if (!(await getServerIsOwner())) notFound();
    return <>{children}</>;
  }
  const userId = await getServerUserId();
  if ((userId || "").trim() === "") notFound();
  return <>{children}</>;
}
