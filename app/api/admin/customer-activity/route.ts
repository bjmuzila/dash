import { NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getCustomerActivity, getSubscription, PAID_STATUSES, listUsersWithLastLogin, type UserWithLastLogin } from "@/lib/db";

// Owner-only customer engagement feed. Joins the page_visits rollup
// (getCustomerActivity) with our own users/sessions tables (email + last
// session created_at as a "last login" proxy) so the admin page can show, per
// customer: last login, ~time on site, pages visited.
//
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

async function loadAuthUsers(): Promise<Map<string, UserWithLastLogin>> {
  const rows = await listUsersWithLastLogin();
  return new Map(rows.map((r) => [r.id, r]));
}

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [activity, authUsers] = await Promise.all([getCustomerActivity(), loadAuthUsers()]);

    const rows = await Promise.all(
      activity.map(async (a) => {
        const au = authUsers.get(a.user_id);
        let paid = false;
        try {
          const sub = await getSubscription(a.user_id);
          paid = !!sub?.status && PAID_STATUSES.has(sub.status);
        } catch { /* treat as unpaid */ }
        return {
          userId: a.user_id,
          email: au?.email ?? null,
          lastLogin: au?.last_login_at ?? null,
          lastSeen: a.last_seen,
          firstSeen: a.first_seen,
          totalLoads: a.total_loads,
          distinctPages: a.distinct_pages,
          sessionCount: a.session_count,
          approxActiveSec: Math.round(a.approx_active_sec),
          topPath: a.top_path,
          paid,
        };
      })
    );

    // Only surface rows we can attribute to a known account (drop orphaned
    // user_ids from deleted users). Newest activity first (already sorted).
    return NextResponse.json({ ok: true, rows: rows.filter((r) => r.email) });
  } catch (err) {
    return NextResponse.json({ error: "Activity load failed", detail: String(err) }, { status: 500 });
  }
}
