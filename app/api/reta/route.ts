import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import {
  listRetaSetups,
  upsertRetaSetup,
  deleteRetaSetup,
  listRetaShots,
  upsertRetaShot,
  deleteRetaShot,
  listRetaWeekNotes,
  upsertRetaWeekNote,
} from "@/lib/db";

// Reta tracker is owner-only and fails CLOSED: only the configured
// OWNER_USER_ID may read/write, and if OWNER_USER_ID is unset all access is
// denied. Same gate as /api/budget — see app/api/budget/route.ts.
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function normDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return ISO_DAY.test(s) ? s : null;
}

// Only the two tracked people; anything else is rejected so a typo can't create
// a third silent column of data.
function normPerson(v: unknown): "brandon" | "heather" | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "brandon" || s === "heather" ? s : null;
}

// Finite, non-negative, and bounded — a stray keystroke shouldn't persist as
// 5000 mg. Returns null for "not provided".
function normNum(v: unknown, max: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

export async function GET() {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const [setups, shots, weekNotes] = await Promise.all([
      listRetaSetups(),
      listRetaShots(),
      listRetaWeekNotes(),
    ]);
    return NextResponse.json({ setups, shots, weekNotes });
  } catch (err) {
    return NextResponse.json({ error: "Reta load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const body = await req.json();
    const action = String(body?.action ?? "");

    // ── Reconstitution in force from a given Sunday (upsert on that date) ──
    if (action === "setup") {
      const effectiveFrom = normDay(body?.effectiveFrom);
      const vialMg = normNum(body?.vialMg, 1000);
      const bacMl = normNum(body?.bacMl, 100);
      if (!effectiveFrom) return NextResponse.json({ error: "Bad effectiveFrom" }, { status: 400 });
      if (!vialMg || !bacMl) return NextResponse.json({ error: "vialMg and bacMl must be > 0" }, { status: 400 });
      const setup = await upsertRetaSetup({
        effective_from: effectiveFrom,
        vial_mg: vialMg,
        bac_ml: bacMl,
        syringe_units: normNum(body?.syringeUnits, 200) ?? 100,
        note: body?.note ? String(body.note).slice(0, 500) : null,
      });
      return NextResponse.json({ ok: true, setup });
    }

    if (action === "setupDelete") {
      const id = Number(body?.id ?? 0);
      if (!id) return NextResponse.json({ error: "Bad id" }, { status: 400 });
      await deleteRetaSetup(id);
      return NextResponse.json({ ok: true });
    }

    // ── One person's week: dose, weight, taken ──
    if (action === "shot") {
      const shotDate = normDay(body?.date);
      const person = normPerson(body?.person);
      if (!shotDate) return NextResponse.json({ error: "Bad date" }, { status: 400 });
      if (!person) return NextResponse.json({ error: "Bad person" }, { status: 400 });
      const shot = await upsertRetaShot({
        shot_date: shotDate,
        person,
        dose_mg: normNum(body?.doseMg, 100) ?? undefined,
        // weight is explicitly clearable: null means "erase", undefined "leave".
        weight_lb: body?.weightLb === undefined ? undefined : normNum(body?.weightLb, 1000),
        taken: body?.taken === undefined ? undefined : body.taken ? 1 : 0,
      });
      return NextResponse.json({ ok: true, shot });
    }

    if (action === "shotDelete") {
      const shotDate = normDay(body?.date);
      const person = normPerson(body?.person);
      if (!shotDate || !person) return NextResponse.json({ error: "Bad key" }, { status: 400 });
      await deleteRetaShot(shotDate, person);
      return NextResponse.json({ ok: true });
    }

    // ── Week note (shared by both people; empty string deletes it) ──
    if (action === "weekNote") {
      const shotDate = normDay(body?.date);
      if (!shotDate) return NextResponse.json({ error: "Bad date" }, { status: 400 });
      await upsertRetaWeekNote(shotDate, body?.note == null ? null : String(body.note).slice(0, 1000));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Reta save failed", detail: String(err) }, { status: 500 });
  }
}
