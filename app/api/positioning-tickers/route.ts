import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { getPositioningTickers, upsertPositioningTickers } from "@/lib/db";

export const dynamic = "force-dynamic";

// Per-user customized Options Positioning row (/test Positioning tab, 4 cards).
// Keyed on the Supabase userId — never a client-supplied identity.

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of input) {
    const sym = String(it ?? "").trim().toUpperCase().slice(0, 12);
    if (!sym || seen.has(sym)) continue;
    if (!/^[A-Z0-9/.^-]+$/.test(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= 4) break;
  }
  return out;
}

export async function GET() {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tickers = await getPositioningTickers(userId);
    return NextResponse.json(
      { tickers },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getServerUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const tickers = sanitize(body?.tickers);
    if (tickers.length !== 4) {
      return NextResponse.json({ error: "Exactly 4 distinct tickers required" }, { status: 400 });
    }
    await upsertPositioningTickers(userId, tickers);
    return NextResponse.json({ ok: true, tickers });
  } catch (err) {
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
