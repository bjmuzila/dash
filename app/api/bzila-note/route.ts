import { NextRequest, NextResponse } from "next/server";
import { getServerIsOwner } from "@/lib/supabase/server";
import { getBzilaNote, upsertBzilaNote } from "@/lib/db";

// Global "Words from Bzila" note shown on the Traders Dashboard. Readable by
// any signed-in visitor; writable/deletable only by the owner. The client-side
// edit UI is cosmetic only — this route is the real gate (getServerIsOwner).

export async function GET() {
  try {
    const row = await getBzilaNote();
    return NextResponse.json({ content: row?.content ?? "", updated_at: row?.updated_at ?? null });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const content = String(body?.content ?? "").slice(0, 8000);
    await upsertBzilaNote(content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await getServerIsOwner())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await upsertBzilaNote("");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Delete failed", detail: String(err) }, { status: 500 });
  }
}
