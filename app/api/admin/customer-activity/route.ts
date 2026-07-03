import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerUserId } from "@/lib/supabase/server";
import { getCustomerActivity, getSubscription, PAID_STATUSES } from "@/lib/db";

// Owner-only customer engagement feed. Joins the page_visits rollup
// (getCustomerActivity) with Supabase Auth (email + last_sign_in_at) so the
// admin page can show, per customer: last login, ~time on site, pages visited.
//
// SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

interface AuthUser { email: string | null; last_sign_in_at: string | null; created_at: string | null }

async function loadAuthUsers(): Promise<Map<string, AuthUser>> {
  const map = new Map<string, AuthUser>();
  if (!SUPABASE_URL || !SERVICE_KEY) return map;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const PER_PAGE = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(error.message);
    const batch = data?.users ?? [];
    if (batch.length === 0) break;
    for (const u of batch) {
      map.set(u.id, {
        email: u.email ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at ?? null,
      });
    }
    if (batch.length < PER_PAGE) break;
  }
  return map;
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
          lastLogin: au?.last_sign_in_at ?? null,
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
