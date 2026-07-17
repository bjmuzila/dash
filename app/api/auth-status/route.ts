import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { countUsers, listRecentUsers, countActiveSessions } from "@/lib/db";

// Owner-only auth status card backend. Reads from our own users/sessions
// tables (formerly Clerk, then Supabase Auth). Response shape kept stable so
// the /dev/owner dashboard card still renders without changes.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function GET() {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let userCount: number | null = null;
  let activeSessions: number | null = null;
  let recent: Array<{ id: string; email: string | null; name: string | null; createdAt: number | null }> = [];
  let statsError: string | null = null;

  try {
    userCount = await countUsers();
    activeSessions = await countActiveSessions();
    const rows = await listRecentUsers(5);
    recent = rows.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      name: null, // no display-name field in our users table
      createdAt: u.created_at ? new Date(u.created_at).getTime() : null,
    }));
  } catch (err) {
    statsError = String((err as Error)?.message ?? err);
  }

  return NextResponse.json({
    configured: true,
    provider: "custom",
    environment: "live",
    mismatch: false,
    stats: { userCount, activeSessions, recent },
    statsError,
  });
}
