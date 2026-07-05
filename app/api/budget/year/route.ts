import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getOrCreateBudgetProfile, adoptDefaultBudgetProfile, listRegister } from "@/lib/db";

export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const BUDGET_PROFILE_KEY = "owner";

export async function GET(req: NextRequest) {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const yearParam = req.nextUrl.searchParams.get("year");
    const year = Number(yearParam) || new Date().getFullYear();

    await adoptDefaultBudgetProfile(BUDGET_PROFILE_KEY);
    const profile = await getOrCreateBudgetProfile(BUDGET_PROFILE_KEY);
    const rows = await listRegister(profile.id, `${year}-01-01`, `${year}-12-31`);
    return NextResponse.json({ year, rows });
  } catch (err) {
    return NextResponse.json({ error: "Year load failed", detail: String(err) }, { status: 500 });
  }
}
