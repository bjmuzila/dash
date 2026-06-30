import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerUserId } from "@/lib/supabase/server";

// Owner-only auth status card backend (formerly Clerk; now Supabase Auth).
// Path/response shape kept stable so the /dev/owner dashboard card still renders
// without changes. Reports whether Supabase auth env is configured and a few
// read-only user stats via the service-role admin API. Never returns secrets.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export async function GET() {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const configured = !!SUPABASE_URL && !!ANON;

  let userCount: number | null = null;
  const activeSessions: number | null = null; // not exposed by Supabase cheaply
  let recent: Array<{ id: string; email: string | null; name: string | null; createdAt: number | null }> = [];
  let statsError: string | null = null;

  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // First page gives us the recent users; total count comes from the
      // paginated response's `total` when available.
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 10 });
      if (error) {
        statsError = error.message;
      } else {
        const users = data?.users ?? [];
        userCount = (data as { total?: number })?.total ?? users.length;
        recent = users.slice(0, 5).map((u) => {
          const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
          const name =
            (typeof meta.full_name === "string" && meta.full_name) ||
            (typeof meta.name === "string" && meta.name) ||
            null;
          return {
            id: u.id,
            email: u.email ?? null,
            name,
            createdAt: u.created_at ? new Date(u.created_at).getTime() : null,
          };
        });
      }
    } catch (err) {
      statsError = String((err as Error)?.message ?? err);
    }
  } else {
    statsError = "SUPABASE_SERVICE_ROLE_KEY not set — user stats unavailable";
  }

  return NextResponse.json({
    configured,
    provider: "supabase",
    environment: configured ? "live" : "unknown",
    mismatch: false,
    stats: { userCount, activeSessions, recent },
    statsError,
  });
}
