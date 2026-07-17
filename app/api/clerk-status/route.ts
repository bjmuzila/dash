// DEPRECATED legacy path. Renamed to /api/auth-status (Clerk was removed long
// ago). Kept as a thin alias so any stray caller keeps working; safe to delete
// this whole folder once nothing hits /api/clerk-status.
export { GET } from "../auth-status/route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
