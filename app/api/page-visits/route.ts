import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getRecentPageVisits, listUsersWithLastLogin } from "@/lib/db";

// Owner-only: the visit log exposes client IPs AND (since the accounts join
// below) the email behind every signed-in visit, so gate reads to the owner.
// Writes happen in /api/page-status (public, every page load); this is read-only.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function GET(req: NextRequest) {
  const userId = await getServerUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 5000);
    // page_visits stores only user_id, so a signed-in visit is an opaque uuid to
    // the client. Resolve it to the account here — one query for the whole users
    // table (small, and the alternative is a join inside a SELECT * hot path) —
    // so the owner map can say WHO was on the page instead of showing a bare id.
    // Failure to load accounts degrades to "everyone is an anonymous visitor"
    // rather than failing the whole request.
    const [rows, accounts] = await Promise.all([
      getRecentPageVisits(limit),
      listUsersWithLastLogin().catch(() => []),
    ]);
    const byUserId = new Map(accounts.map((a) => [String(a.id), a]));

    const visits = rows.map((r) => {
      const account = r.user_id ? byUserId.get(String(r.user_id)) : undefined;
      return {
        id: r.id,
        pageKey: r.page_key ?? null,
        pageLabel: r.page_label ?? null,
        path: r.path ?? null,
        userId: r.user_id ?? null,
        ip: r.ip ?? null,
        // Cloudflare geo. Null on rows logged before the managed transform was
        // enabled, and on anything that reached the origin without crossing the edge.
        country: r.country ?? null,
        region: r.region ?? null,
        city: r.city ?? null,
        // City centroids, so the owner map can plot bubbles. Numbers, not strings —
        // pg hands DOUBLE PRECISION back as a JS number already.
        lat: r.latitude ?? null,
        lon: r.longitude ?? null,
        // Acquisition. Non-null only on entry rows (the first beacon of a browser
        // session) — see lib/visitorAttribution.ts. Count sessions with isEntry,
        // then group those by channel / referrerHost / utmSource.
        isEntry: Boolean(r.is_entry),
        referrer: r.referrer ?? null,
        referrerHost: r.referrer_host ?? null,
        utmSource: r.utm_source ?? null,
        utmMedium: r.utm_medium ?? null,
        utmCampaign: r.utm_campaign ?? null,
        utmTerm: r.utm_term ?? null,
        utmContent: r.utm_content ?? null,
        channel: r.channel ?? null,
        // Device is filled on every row (it comes from the UA header).
        browser: r.browser ?? null,
        os: r.os ?? null,
        deviceType: r.device_type ?? null,
        isBot: Boolean(r.is_bot),
        // Account identity. All null for signed-out traffic — the owner map
        // labels those dots "Visitor". `userId` with a null `userEmail` means the
        // visit carried a session for an account that no longer exists.
        userEmail: account?.email ?? null,
        userCreatedAt: account?.created_at ?? null,
        userLastLoginAt: account?.last_login_at ?? null,
        isOwner: Boolean(r.user_id && OWNER_USER_ID && r.user_id === OWNER_USER_ID),
        createdAt: r.created_at ?? null,
      };
    });
    return NextResponse.json({ visits });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
