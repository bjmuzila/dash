import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import {
  getOrCreateBudgetProfile,
  adoptDefaultBudgetProfile,
  insertBudgetEntry,
  listBudgetCategories,
  listBudgetEntries,
  upsertBudgetCategory,
  deleteBudgetCategory,
  setRegisterCategory,
  upsertDailyBalance,
  getLatestDailyBalance,
  getDailyBalanceBefore,
  insertRegisterRow,
  updateRegisterRow,
  deleteRegisterRow,
  deleteRegisterByTag,
  listRegister,
  insertRecurring,
  updateRecurring,
  deleteRecurring,
  listRecurring,
  insertAmazonRow,
  deleteAmazonRow,
  listAmazonRows,
  insertPropRow,
  updatePropRow,
  deletePropRow,
  listPropRows,
  type RegisterBank,
  type RecurringFrequency,
} from "@/lib/db";

// Budget is owner-only. Fails CLOSED: only the configured OWNER_USER_ID may
// read/write, and if OWNER_USER_ID is unset/misconfigured all access is denied.
// All data lives under one stable profile so it's the owner's single budget.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const BUDGET_PROFILE_KEY = "owner";

// Returns the profile key if access is allowed, or null to reject.
async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
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

    // Prop ledger is shown for the whole year (monthly grouped), so load it by year.
    const year = month.slice(0, 4);
    await adoptDefaultBudgetProfile(BUDGET_PROFILE_KEY);
    const profile = await getOrCreateBudgetProfile(BUDGET_PROFILE_KEY);
    const [categories, entries, register, recurring, amazonRows, propRows, dailyBalance] = await Promise.all([
      listBudgetCategories(profile.id),
      listBudgetEntries(profile.id, 500),
      listRegister(profile.id, from, to),
      listRecurring(profile.id),
      listAmazonRows(profile.id, from, to),
      listPropRows(profile.id, `${year}-01-01`, `${year}-12-31`),
      getLatestDailyBalance(profile.id),
    ]);
    const prevDailyBalance = dailyBalance ? await getDailyBalanceBefore(profile.id, dailyBalance.day) : null;
    return NextResponse.json({ profile, categories, entries, month, register, recurring, amazonRows, propRows, dailyBalance, prevDailyBalance });
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

    if (action === "categoryDelete") {
      await deleteBudgetCategory(profile.id, Number(body?.id ?? 0));
      return NextResponse.json({ ok: true });
    }

    // Manually-entered opening balance for a given day (upsert per day).
    if (action === "dailyBalance") {
      const row = await upsertDailyBalance({
        profile_id: profile.id,
        day: String(body?.day ?? "").trim() || currentMonth() + "-01",
        coastal: Number(body?.coastal ?? 0),
        truist: Number(body?.truist ?? 0),
        secu: Number(body?.secu ?? 0),
      });
      return NextResponse.json({ ok: true, dailyBalance: row });
    }

    // Assign a register row to a category (or clear it with categoryId = null).
    if (action === "assignCategory") {
      const catId = body?.categoryId == null ? null : Number(body.categoryId);
      await setRegisterCategory(profile.id, Number(body?.id ?? 0), catId);
      return NextResponse.json({ ok: true });
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
        // Set when a recurring occurrence is edited into a concrete row so the
        // client can suppress the synthetic twin (format __recur__:ruleId:date).
        recurring_tag: body?.recurringTag ? String(body.recurringTag) : null,
      });
      return NextResponse.json({ ok: true, row });
    }

    // Bulk insert from the screenshot importer — one round-trip for N rows.
    if (action === "registerRowsBulk") {
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      let inserted = 0;
      for (const r of rows) {
        const entry_date = String(r?.date ?? "").trim();
        const label = String(r?.label ?? "").trim();
        const amount = Number(r?.amount ?? 0);
        if (!entry_date || !label || !Number.isFinite(amount) || amount === 0) continue;
        await insertRegisterRow({
          profile_id: profile.id,
          entry_date,
          sort_order: (Date.now() % 100000) + inserted,
          label,
          bank: normBank(r?.bank),
          amount,
        });
        inserted++;
      }
      return NextResponse.json({ ok: true, inserted });
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
      const row = await insertAmazonRow({
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

    // ── Prop-firm spending (purchase or payout) ──
    if (action === "propAdd") {
      const row = await insertPropRow({
        profile_id: profile.id,
        entry_date: String(body?.date ?? "").trim(),
        source: body?.source ? String(body.source) : "prop",
        firm: body?.firm ? String(body.firm) : "TPT",
        accounts: Number(body?.accounts ?? 0),
        cost: Number(body?.cost ?? 0),
        payout: Number(body?.payout ?? 0),
        note: body?.note ? String(body.note) : null,
      });
      return NextResponse.json({ ok: true, prop: row });
    }

    if (action === "propUpdate") {
      await updatePropRow(profile.id, Number(body?.id ?? 0), {
        entry_date: body?.date != null ? String(body.date) : undefined,
        source: body?.source != null ? String(body.source) : undefined,
        firm: body?.firm != null ? String(body.firm) : undefined,
        accounts: body?.accounts != null ? Number(body.accounts) : undefined,
        cost: body?.cost != null ? Number(body.cost) : undefined,
        payout: body?.payout != null ? Number(body.payout) : undefined,
        note: body?.note !== undefined ? (body.note ? String(body.note) : null) : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "propDelete") {
      await deletePropRow(profile.id, Number(body?.id ?? 0));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Budget save failed", detail: String(err) }, { status: 500 });
  }
}
