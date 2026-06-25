import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRecentPageVisits } from "@/lib/db";

// Owner-only: the visit log exposes client IPs (PII), so gate reads to the owner.
// Writes happen in /api/page-status (public, every page load); this is read-only.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);
    const rows = await getRecentPageVisits(limit);
    const visits = rows.map((r) => ({
      id: r.id,
      pageKey: r.page_key ?? null,
      pageLabel: r.page_label ?? null,
      path: r.path ?? null,
      userId: r.user_id ?? null,
      ip: r.ip ?? null,
      createdAt: r.created_at ?? null,
    }));
    return NextResponse.json({ visits });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
