import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getIctCardPrefs, upsertIctCardPrefs } from "@/lib/db";

// Per-user /ict glossary card visibility. hiddenCards = concept ids toggled OFF.
// Keyed on the Clerk userId (never a client-supplied identity).

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const hiddenCards = await getIctCardPrefs(userId);
    return NextResponse.json({ hiddenCards });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const hiddenCards = Array.isArray(body.hiddenCards)
      ? body.hiddenCards.map((x: unknown) => String(x)).slice(0, 200)
      : [];
    await upsertIctCardPrefs(userId, hiddenCards);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
