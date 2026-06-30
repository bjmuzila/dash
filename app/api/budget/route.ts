import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import {
  getOrCreateBudgetProfile,
  adoptDefaultBudgetProfile,
  insertBudgetEntry,
  listBudgetCategories,
  listBudgetEntries,
  upsertBudgetCategory,
  insertRegisterRow,
  updateRegisterRow,
  deleteRegisterRow,
  deleteRegisterByTag,
  listRegister,
  insertRecurring,
  updateRecurring,
  deleteRecurring,
  listRecurring,
  upsertAmazonRow,
  deleteAmazonRow,
  listAmazonRows,
  type RegisterBank,
  type RecurringFrequency,
} from "@/lib/db";

// Budget is owner-only. If OWNER_USER_ID is configured, only that Clerk user may
// read/write; otherwise (not yet set) any signed-in user is allowed so the owner
// isn't locked out before configuring env. All data lives under one stable
// profile so it's the owner's single budget regardless of which key is active.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const BUDGET_PROFILE_KEY = "owner";

// Returns the profile key if access is allowed, or null to reject.
async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

// month is "YYYY-MM"; returns inclusive [first, last] day strings "YYYY-MM-DD".
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normBank(v: unknown): RegisterBank {
  return v === "coastal" || v === "truist" ? v : "secu";
}

function normFreq(v: unknown): RecurringFrequency {
  return v === "weekly" || v === "biweekly" ? v : "monthly";
}

export async function GET(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const month = req.nextUrl.searchParams.get("month") || currentMonth();
    const { from, to } = monthRange(month);

    await adoptDefaultBudgetProfile(BUDGET_PROFILE_KEY);
    const profile = await getOrCreateBudgetProfile(BUDGET_PROFILE_KEY);
    const [categories, entries, register, recurring, amazonRows] = await Promise.all([
      listBudgetCategories(profile.id),
      listBudgetEntries(profile.id, 500),
      listRegister(profile.id, from, to),
      listRecurring(profile.id),
      listAmazonRows(profile.id, from, to),
    ]);
    return NextResponse.json({ profile, categories, entries, month, register, recurring, amazonRows });
  } catch (err) {
    return NextResponse.json({ error: "Budget load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const body = await req.json();
    const action = String(body?.action ?? "");
    // Always the single owner profile — never trust a client-supplied name.
    await adoptDefaultBudgetProfile(BUDGET_PROFILE_KEY);
    const profile = await getOrCreateBudgetProfile(BUDGET_PROFILE_KEY);

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

    // ── Check register ──
    if (action === "registerRow") {
      const row = await insertRegisterRow({
        profile_id: profile.id,
        entry_date: String(body?.date ?? "").trim(),
        sort_order: Number(body?.sortOrder ?? Date.now() % 100000),
        label: String(body?.label ?? "").trim(),
        bank: normBank(body?.bank),
        amount: Number(body?.amount ?? 0),
      });
      return NextResponse.json({ ok: true, row });
    }

    if (action === "updateRow") {
      await updateRegisterRow(profile.id, Number(body?.id ?? 0), {
        entry_date: body?.date != null ? String(body.date) : undefined,
        label: body?.label != null ? String(body.label) : undefined,
        bank: body?.bank != null ? normBank(body.bank) : undefined,
        amount: body?.amount != null ? Number(body.amount) : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteRow") {
      await deleteRegisterRow(profile.id, Number(body?.id ?? 0));
      return NextResponse.json({ ok: true });
    }

    // Seed/replace the BEGINNING balances for a month — one row per bank (the
    // current balance of each account). Stored on the first day with
    // is_beginning=1 and sort_order=-1 so they sit on top of the register.
    if (action === "setBeginning") {
      const month = String(body?.month ?? currentMonth());
      const { from, to } = monthRange(month);
      await deleteRegisterByTag(profile.id, from, to, "__beginning__");
      const balances = (body?.balances ?? {}) as Record<string, unknown>;
      const banks: RegisterBank[] = ["coastal", "truist", "secu"];
      for (const bank of banks) {
        await insertRegisterRow({
          profile_id: profile.id,
          entry_date: from,
          sort_order: -1,
          label: "BEGINNING",
          bank,
          amount: Number(balances[bank] ?? 0),
          is_beginning: 1,
          recurring_tag: "__beginning__",
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Recurring rules (repeat weekly/biweekly/monthly; computed live) ──
    if (action === "recurringAdd") {
      const row = await insertRecurring({
        profile_id: profile.id,
        label: String(body?.label ?? "").trim().toUpperCase(),
        bank: normBank(body?.bank),
        amount: Number(body?.amount ?? 0),
        frequency: normFreq(body?.frequency),
        anchor_date: String(body?.anchorDate ?? "").trim(),
      });
      return NextResponse.json({ ok: true, row });
    }

    if (action === "recurringUpdate") {
      await updateRecurring(profile.id, Number(body?.id ?? 0), {
        label: body?.label != null ? String(body.label).toUpperCase() : undefined,
        bank: body?.bank != null ? normBank(body.bank) : undefined,
        amount: body?.amount != null ? Number(body.amount) : undefined,
        frequency: body?.frequency != null ? normFreq(body.frequency) : undefined,
        anchor_date: body?.anchorDate != null ? String(body.anchorDate) : undefined,
        active: body?.active != null ? (body.active ? 1 : 0) : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "recurringDelete") {
      await deleteRecurring(profile.id, Number(body?.id ?? 0));
      return NextResponse.json({ ok: true });
    }

    // ── Amazon delivery row (date / pay / gas) ──
    if (action === "amazon") {
      const row = await upsertAmazonRow({
        profile_id: profile.id,
        work_date: String(body?.date ?? "").trim(),
        pay: Number(body?.pay ?? 0),
        gas: Number(body?.gas ?? 0),
      });
      return NextResponse.json({ ok: true, amazon: row });
    }

    if (action === "deleteAmazon") {
      await deleteAmazonRow(profile.id, Number(body?.id ?? 0));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Budget save failed", detail: String(err) }, { status: 500 });
  }
}
