import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateBudgetProfile,
  insertBudgetEntry,
  listBudgetCategories,
  listBudgetEntries,
  listBudgetProfiles,
  upsertBudgetCategory,
} from "@/lib/db";

export async function GET() {
  try {
    const profiles = await listBudgetProfiles();
    const profile = profiles[0] ?? (await getOrCreateBudgetProfile());
    const [categories, entries] = await Promise.all([
      listBudgetCategories(profile.id),
      listBudgetEntries(profile.id, 500),
    ]);
    return NextResponse.json({ profile, profiles, categories, entries });
  } catch (err) {
    return NextResponse.json({ error: "Budget load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");
    const profile = await getOrCreateBudgetProfile(String(body?.profileName ?? "Default"));

    if (action === "category") {
      const category = await upsertBudgetCategory({
        profile_id: profile.id,
        name: String(body?.name ?? "").trim(),
        amount: Number(body?.amount ?? 0),
        period: String(body?.period ?? "monthly"),
        color: body?.color ? String(body.color) : null,
      });
      return NextResponse.json({ ok: true, category });
    }

    if (action === "entry") {
      const entry = await insertBudgetEntry({
        profile_id: profile.id,
        category_id: body?.categoryId ? Number(body.categoryId) : null,
        type: body?.type === "income" ? "income" : "expense",
        amount: Number(body?.amount ?? 0),
        title: String(body?.title ?? "").trim(),
        notes: body?.notes ? String(body.notes) : null,
        occurred_at: String(body?.occurredAt ?? new Date().toISOString()),
      });
      return NextResponse.json({ ok: true, entry });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Budget save failed", detail: String(err) }, { status: 500 });
  }
}
