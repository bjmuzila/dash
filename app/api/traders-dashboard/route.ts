import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getTdPrefs, upsertTdPrefs } from "@/lib/db";

// Per-user Traders Dashboard prefs (schedule, tasks, weather zip). Keyed on the
// Clerk userId — never a client-supplied identity.

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const prefs = await getTdPrefs(userId);
    return NextResponse.json({
      zip: prefs?.zip ?? null,
      schedule: prefs?.schedule ?? [],
      tasks: prefs?.tasks ?? [],
      links: (prefs as Record<string, unknown>)?.links ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const fields: { zip?: string | null; schedule?: unknown[]; tasks?: unknown[]; links?: unknown[] } = {};
    if ("zip" in body) fields.zip = body.zip ? String(body.zip).trim().slice(0, 10) : null;
    if (Array.isArray(body.schedule)) fields.schedule = body.schedule;
    if (Array.isArray(body.tasks)) fields.tasks = body.tasks;
    if (Array.isArray(body.links)) fields.links = body.links;
    await upsertTdPrefs(userId, fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
