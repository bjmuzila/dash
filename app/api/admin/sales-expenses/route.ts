import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { listSalesExpenses, addSalesExpense, removeSalesExpense } from "@/lib/db";

// Owner-only management of business expenses shown on /owner/dev/sales.
//   GET    → list every expense (recurring + one-off).
//   POST   → { name, category, amountCents, cadence } add one.
//   DELETE → ?id=... remove one.
//
// SECURITY: fails CLOSED — unset/misconfigured OWNER_USER_ID rejects all.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const CADENCES = new Set(["monthly", "yearly", "once"]);

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

export async function GET() {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const rows = await listSalesExpenses();
    return NextResponse.json({ ok: true, count: rows.length, expenses: rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const category = String(body?.category ?? "other").trim() || "other";
    const amountCents = Math.round(Number(body?.amountCents));
    const cadence = String(body?.cadence ?? "monthly").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "amountCents must be a positive number" }, { status: 400 });
    }
    if (!CADENCES.has(cadence)) {
      return NextResponse.json({ error: "cadence must be monthly, yearly, or once" }, { status: 400 });
    }
    const expense = await addSalesExpense(name, category, amountCents, cadence as "monthly" | "yearly" | "once");
    return NextResponse.json({ ok: true, expense });
  } catch (err) {
    return NextResponse.json({ error: "Add failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await ownerGate();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id query param required" }, { status: 400 });
    const { removed } = await removeSalesExpense(id);
    return NextResponse.json({ ok: true, removed, id });
  } catch (err) {
    return NextResponse.json({ error: "Remove failed", detail: String(err) }, { status: 500 });
  }
}
